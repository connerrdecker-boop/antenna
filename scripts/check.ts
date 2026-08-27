/**
 * npm run check — PART 2.6, THE CHECK SUITE. "Runs green or nothing ships."
 *
 * The column lists and rules below are transcribed independently from the
 * blueprint's Part III / Part 8.2 rather than derived from db/schema.ts. That is
 * deliberate: a check generated from the code under test can only ever agree
 * with it. This one can catch drift.
 */
import { readFileSync } from 'node:fs'
import { rmSync } from 'node:fs'
import { CAPS } from '@/config/limits'
import { DB_PATH, openSqlite } from '@/db/connection'
import {
  DECISIONS, LINK_FETCH_STATUSES, LOI_TIERS, METROS, STATUSES, TIERS, type Status,
} from '@/db/enums'
import { ENFORCEMENT_TRIGGERS } from '@/db/enforcement'
import { listCandidates } from '@/db/repo'
import { HASHTAG_LIBRARY_STATUS } from '@/config/hashtags'
import { METRO_TERMS } from '@/config/metros'
import { QUERY_LIBRARY_STATUS, QUERY_TEMPLATES } from '@/config/queries'
import { SEED_LIST_STATUS } from '@/config/seeds'
import { normalizeLinkUrl } from '@/lib/handle'
import { TRANSITIONS } from '@/lib/status'
import { extractHandles, extractPlatformTells, extractPrices } from '@/pipeline/harvest/extract'
import { ensureBudget } from '@/pipeline/lib/budget'
import { isFetchableUrl } from '@/pipeline/lib/fetchLink'
import { renderScorePrompt, SCORE_PROMPT_VERSION } from '@/pipeline/score'
import { buildFewShotBlock } from '@/prompts/fewshot'
import { runMigrations } from './migrate'

// ---------------------------------------------------------- PART III canon

const CANON_COLUMNS: Record<string, string[]> = {
  candidates: [
    'id', 'handle', 'ig_url', 'name', 'follower_count', 'bio', 'link_url', 'link_domain',
    'link_contents', 'link_fetch_status', 'metro', 'metro_confidence', 'source', 'source_detail',
    'first_seen', 'last_enriched', 'pre_score', 'score', 'tier', 'score_prompt_version',
    'evidence', 'hook_draft', 'stack_signals', 'extracted', 'status', 'followup_count',
    'loi_tier', 'notes', 'next_action_date', 'created_at', 'updated_at',
  ],
  status_history: ['candidate_id', 'from_status', 'to_status', 'at', 'note'],
  ratifications: ['candidate_id', 'decision', 'reason', 'at'],
  harvest_runs: [
    'adapter', 'params', 'started_at', 'finished_at', 'items_found', 'items_new',
    'est_cost', 'status', 'error',
  ],
  outreach_log: ['candidate_id', 'direction', 'text', 'at'],
  observations: [
    'handle', 'observed_at', 'follower_count', 'posts_30d', 'format_mix',
    'engagement_proxy', 'source',
  ],
  spend: ['at', 'category', 'amount', 'run_ref', 'note'],
}

/**
 * PART 8.2 — the status machine, transcribed from the blueprint by hand.
 *
 * This MUST NOT be derived from lib/status.ts: db/enforcement.ts compiles the DB
 * trigger from that same module, so a check that imports it moves with the code
 * and can never see graph drift. Everything below is read off the blueprint.
 */
const CANON_TRANSITIONS: Record<string, string[]> = {
  sourced: ['qualified', 'banked', 'rejected'],
  // The `sourced` targets on qualified/rejected/banked are the ratify-undo
  // edges (Part VII `u`, ratified A2 and written into the Part 8.2 diagram):
  // the queue must be able to return a mis-keyed candidate. Ratify-surface
  // only — the drawer never offers them.
  qualified: ['dmed', 'declined', 'sourced'],
  dmed: ['replied', 'no_response', 'declined'],
  replied: ['call_booked', 'declined'],
  call_booked: ['demo_given', 'declined'],
  demo_given: ['loi_sent', 'declined'],
  loi_sent: ['signed', 'declined'],
  // Re-entry edges, ratified in A1 and written into Part 8.2 as canon.
  no_response: ['replied'],
  banked: ['qualified', 'sourced'],
  rejected: ['sourced'],
  // Terminal.
  signed: [],
  declined: [],
}

/** Legality per the CANON copy above — never per the code under test. */
const canonAllows = (from: string | null, to: string) =>
  from !== null && (CANON_TRANSITIONS[from] ?? []).includes(to)

const CANON_ENUMS: Record<string, string[]> = {
  status: ['sourced', 'qualified', 'dmed', 'replied', 'no_response', 'call_booked', 'demo_given', 'loi_sent', 'signed', 'declined', 'rejected', 'banked'],
  tier: ['A', 'B', 'C', 'X'],
  loi_tier: ['t1', 't2', 't3'],
  metro: ['nyc', 'sofla', 'other', 'unknown'],
  decision: ['approve', 'reject', 'bank', 'flag'],
  link_fetch_status: ['ok', 'failed', 'skipped'],
}

// --------------------------------------------------------------- harness

let failures = 0
let warnings = 0

function assert(label: string, ok: boolean, detail = '') {
  if (ok) console.log(`  ok    ${label}`)
  else { failures++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
function warn(label: string, detail: string) {
  warnings++
  console.log(`  warn  ${label} — ${detail}`)
}
function section(title: string) { console.log(`\n${title}`) }

// --------------------------------------------------------------- the run

const sqlite = openSqlite(DB_PATH)
const q = <T>(sql: string, ...args: unknown[]): T[] => sqlite.prepare(sql).all(...args) as T[]
const one = <T>(sql: string, ...args: unknown[]): T => sqlite.prepare(sql).get(...args) as T

console.log(`antenna check — ${DB_PATH}`)

// 1. Schema validates.
section('1. schema validates (Part III)')
{
  const tables = new Set(q<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name))
  for (const table of Object.keys(CANON_COLUMNS)) {
    if (!tables.has(table)) { assert(`table ${table} exists`, false); continue }
    const info = q<{ name: string; dflt_value: string | null }>(`PRAGMA table_info(${table})`)
    const cols = new Set(info.map((r) => r.name))
    const missing = CANON_COLUMNS[table].filter((c) => !cols.has(c))
    assert(`table ${table} carries every Part III column`, missing.length === 0, `missing: ${missing.join(', ')}`)
    // `id` is the one documented invention: a surrogate PK on the log tables.
    // Documented allowances beyond Part III's lists: `id` (surrogate PK on the
    // log tables, ratified A1) and `score_failed` (the flag Part 6.2 itself
    // requires — "flag score_failed for manual review" — ratified A2).
    const ALLOWED_EXTRA = ['id', 'score_failed']
    const extra = [...cols].filter((c) => !CANON_COLUMNS[table].includes(c) && !ALLOWED_EXTRA.includes(c))
    assert(`table ${table} carries no columns Part III does not name`, extra.length === 0, `extra: ${extra.join(', ')}`)
  }
  // Part III names two defaults explicitly.
  {
    const info = q<{ name: string; dflt_value: string | null }>('PRAGMA table_info(candidates)')
    const dflt = (c: string) => info.find((r) => r.name === c)?.dflt_value ?? null
    assert("candidates.status defaults to 'sourced'", dflt('status') === "'sourced'", `got ${dflt('status')}`)
    assert('candidates.followup_count defaults to 0', String(dflt('followup_count')) === '0', `got ${dflt('followup_count')}`)
  }
  // Structural equality against the LIVE arrays, not a substring scan of the
  // source text: a scan is satisfied by the string appearing anywhere in the
  // file, so it cannot see a dropped value that also exists in another enum,
  // and can never see an invented extra one.
  const LIVE_ENUMS: Record<string, readonly string[]> = {
    status: STATUSES, tier: TIERS, loi_tier: LOI_TIERS,
    metro: METROS, decision: DECISIONS, link_fetch_status: LINK_FETCH_STATUSES,
  }
  for (const [name, canon] of Object.entries(CANON_ENUMS)) {
    const live = LIVE_ENUMS[name]
    assert(`enum ${name} matches Part III exactly (order, spelling, no extras)`,
      JSON.stringify([...(live ?? [])]) === JSON.stringify(canon),
      `code has ${JSON.stringify(live ?? null)}, canon is ${JSON.stringify(canon)}`)
  }

  // The graph the enforcement trigger is compiled from must equal the canon.
  // Normalise both key order and edge order: neither carries meaning, but
  // JSON.stringify is sensitive to both.
  const normGraph = (g: Record<string, readonly string[]>) =>
    JSON.stringify(Object.keys(g).sort().map((k) => [k, [...g[k]].sort()]))
  const liveGraph = normGraph(Object.fromEntries(STATUSES.map((st) => [st, TRANSITIONS[st] ?? []])))
  const canonGraph = normGraph(CANON_TRANSITIONS)
  assert('the Part 8.2 transition graph matches the blueprint exactly',
    liveGraph === canonGraph, `code: ${liveGraph} vs canon: ${canonGraph}`)

  const triggers = new Set(q<{ name: string }>("SELECT name FROM sqlite_master WHERE type='trigger'").map((r) => r.name))
  const missingTriggers = ENFORCEMENT_TRIGGERS.filter((t) => !triggers.has(t))
  assert(`all ${ENFORCEMENT_TRIGGERS.length} enforcement triggers installed`, missingTriggers.length === 0, missingTriggers.join(', '))
}

// 2. Handle uniqueness holds.
section('2. handle uniqueness holds (Part III: handle is the dedupe key)')
{
  const dupes = q<{ handle: string; c: number }>('SELECT handle, count(*) c FROM candidates GROUP BY handle HAVING c > 1')
  assert('no duplicate handles', dupes.length === 0, dupes.map((d) => `${d.handle}×${d.c}`).join(', '))
  const notLower = q<{ handle: string }>('SELECT handle FROM candidates WHERE handle <> lower(handle)')
  assert('every handle is lowercased', notLower.length === 0, notLower.map((r) => r.handle).join(', '))
  const notBare = q<{ handle: string }>("SELECT handle FROM candidates WHERE handle GLOB '*[ @/]*'")
  assert('every handle is bare (no @, space or slash)', notBare.length === 0, notBare.map((r) => r.handle).join(', '))
  const idx = q<{ name: string; unique: number }>("PRAGMA index_list('candidates')")
  assert('a UNIQUE index backs handle', idx.some((i) => i.unique === 1))
}

// 3. Every candidate carries source + first_seen.
section('3. provenance on every row (Law 4 / Part 2.6)')
{
  const bad = q<{ id: number }>("SELECT id FROM candidates WHERE source IS NULL OR trim(source)='' OR first_seen IS NULL OR trim(first_seen)=''")
  assert('every candidate carries source + first_seen', bad.length === 0, `${bad.length} rows`)
  const obs = q<{ id: number }>("SELECT id FROM observations WHERE source IS NULL OR trim(source)=''")
  assert('every observation carries source', obs.length === 0, `${obs.length} rows`)
}

// 4. Every status change has a status_history row.
section('4. every status change has a status_history row (Part III)')
{
  const cands = q<{ id: number; handle: string; status: Status }>('SELECT id, handle, status FROM candidates')
  let chainBreaks: string[] = []
  let illegal: string[] = []
  let noGenesis: string[] = []
  let bornMidFunnel: string[] = []

  for (const c of cands) {
    const hist = q<{ from_status: Status | null; to_status: Status }>(
      'SELECT from_status, to_status FROM status_history WHERE candidate_id=? ORDER BY id', c.id,
    )
    if (!hist.length) { chainBreaks.push(`${c.handle}: no history at all`); continue }
    if (hist[0].from_status !== null) noGenesis.push(c.handle)
    // A candidate is born sourced; a chain that STARTS mid-funnel means the row
    // was minted rather than transitioned, and its real history is gone.
    if (hist[0].to_status !== 'sourced') bornMidFunnel.push(`${c.handle}: born ${hist[0].to_status}`)
    // Walk the chain: each row's from_status must equal the previous to_status,
    // each hop must be legal, and the last to_status must equal the live status.
    for (let i = 1; i < hist.length; i++) {
      if (hist[i].from_status !== hist[i - 1].to_status) {
        chainBreaks.push(`${c.handle}: ${hist[i - 1].to_status} then from=${hist[i].from_status}`)
      }
      if (!canonAllows(hist[i].from_status, hist[i].to_status)) {
        illegal.push(`${c.handle}: ${hist[i].from_status} -> ${hist[i].to_status}`)
      }
    }
    if (hist[hist.length - 1].to_status !== c.status) {
      chainBreaks.push(`${c.handle}: history ends at ${hist[hist.length - 1].to_status}, row says ${c.status}`)
    }
  }
  assert('current status is reconstructible from history for every candidate', chainBreaks.length === 0, chainBreaks.join(' | '))
  assert('every recorded transition is legal under Part 8.2', illegal.length === 0, illegal.join(' | '))
  assert('every candidate has a genesis history row', noGenesis.length === 0, noGenesis.join(', '))
  assert('every candidate was born sourced, not minted mid-funnel', bornMidFunnel.length === 0, bornMidFunnel.join(' | '))

  const orphan = one<{ c: number }>('SELECT count(*) c FROM status_history sh LEFT JOIN candidates c ON c.id=sh.candidate_id WHERE c.id IS NULL')
  assert('no orphaned history rows', orphan.c === 0, `${orphan.c} orphans`)
}

// 5. signed requires loi_tier.
section('5. signed requires loi_tier (Part 8.2)')
{
  const bad = q<{ handle: string }>("SELECT handle FROM candidates WHERE status='signed' AND (loi_tier IS NULL OR trim(loi_tier)='')")
  assert('no signed candidate lacks an loi_tier', bad.length === 0, bad.map((r) => r.handle).join(', '))
  const badTier = q<{ handle: string }>(`SELECT handle FROM candidates WHERE loi_tier IS NOT NULL AND loi_tier NOT IN ('t1','t2','t3')`)
  assert('every loi_tier is t1|t2|t3', badTier.length === 0, badTier.map((r) => r.handle).join(', '))
  const overFollowup = q<{ handle: string; followup_count: number }>('SELECT handle, followup_count FROM candidates WHERE followup_count > 1 OR followup_count < 0')
  assert('follow-up policy holds: at most one per candidate', overFollowup.length === 0, overFollowup.map((r) => `${r.handle}=${r.followup_count}`).join(', '))
}

// 6. Observations are append-only (no UPDATE path exists).
section('6. observations are append-only — no UPDATE path exists (Law 9)')
{
  const src = readFileSync('db/observations.ts', 'utf8')
  const forbidden = [/\.update\s*\(/, /\bUPDATE\s+observations\b/i, /\.delete\s*\(/, /\bDELETE\s+FROM\s+observations\b/i]
  assert('db/observations.ts exposes no update or delete path', !forbidden.some((re) => re.test(src)))

  const triggers = q<{ name: string }>("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='observations'").map((r) => r.name)
  assert('observations_no_update trigger present', triggers.includes('observations_no_update'))
  assert('observations_no_delete trigger present', triggers.includes('observations_no_delete'))

  // Behavioural proof, on a throwaway DB so the real one is never touched.
  const probePath = '/tmp/antenna-check-probe.db'
  for (const suffix of ['', '-wal', '-shm']) rmSync(probePath + suffix, { force: true })
  runMigrations(probePath)
  const p = openSqlite(probePath)
  const at = new Date().toISOString()
  p.exec(`INSERT INTO observations (handle, observed_at, source) VALUES ('probe','${at}','check')`)
  const blocked = (fn: () => void) => { try { fn(); return false } catch { return true } }
  assert('UPDATE on observations aborts', blocked(() => p.exec('UPDATE observations SET follower_count=1')))
  assert('DELETE on observations aborts', blocked(() => p.exec('DELETE FROM observations')))
  assert('raw SQL cannot skip the funnel (sourced -> signed)', blocked(() => {
    p.exec(`INSERT INTO candidates (handle,source,first_seen,created_at,updated_at) VALUES ('probe','check','${at}','${at}','${at}')`)
    p.exec("UPDATE candidates SET status='signed', loi_tier='t1' WHERE handle='probe'")
  }))
  const rawInsert = (h: string) => () =>
    p.exec(`INSERT INTO candidates (handle,source,first_seen,created_at,updated_at) VALUES ('${h}','check','${at}','${at}','${at}')`)
  assert('raw SQL cannot insert an ASCII-uppercase handle', blocked(rawInsert('Probe2')))
  // SQLite's lower() folds ASCII only — the guard must be a character whitelist.
  assert('raw SQL cannot insert a NON-ASCII uppercase handle', blocked(rawInsert('Ärnold')))
  assert('raw SQL cannot insert a handle with a hyphen or space', blocked(rawInsert('probe-three')))
  assert('raw SQL cannot insert an over-length handle', blocked(rawInsert('p'.repeat(31))))
  // The INSERT door, not just the UPDATE door: minting a candidate mid-funnel
  // must abort, or INSERT OR REPLACE can teleport one and erase its chain.
  assert('raw SQL cannot mint a candidate mid-funnel', blocked(() =>
    p.exec(`INSERT INTO candidates (handle,source,first_seen,status,loi_tier,created_at,updated_at) VALUES ('ghostsigned','check','${at}','signed','t1','${at}','${at}')`)))
  assert('INSERT OR REPLACE cannot teleport a candidate and erase its history', blocked(() =>
    p.exec(`INSERT OR REPLACE INTO candidates (handle,source,first_seen,status,loi_tier,created_at,updated_at) VALUES ('probe','check','${at}','signed','t1','${at}','${at}')`)))

  // Own handle, and guarded: if an earlier probe leaves 'probe' somewhere
  // unexpected, this must FAIL rather than throw and abort the whole suite
  // before sections 6b/7/8 have run.
  assert('a raw status UPDATE still writes history', (() => {
    try {
      p.exec(`INSERT INTO candidates (handle,source,first_seen,created_at,updated_at) VALUES ('histprobe','check','${at}','${at}','${at}')`)
      p.exec("UPDATE candidates SET status='qualified' WHERE handle='histprobe'")
      const h = p.prepare(
        "SELECT count(*) c FROM status_history WHERE to_status='qualified' AND candidate_id=(SELECT id FROM candidates WHERE handle='histprobe')",
      ).get() as { c: number }
      return h.c === 1
    } catch { return false }
  })())
  p.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(probePath + suffix, { force: true })
}

// 6b. days-in-status is correlated to the right candidate.
section('6b. days-in-status reads each candidate\'s own last transition')
{
  const truth = new Map(
    q<{ id: number; last_at: string }>(
      `SELECT c.id, (SELECT sh.at FROM status_history sh WHERE sh.candidate_id = c.id
                     ORDER BY sh.id DESC LIMIT 1) AS last_at
       FROM candidates c`,
    ).map((r) => [r.id, r.last_at]),
  )
  const rows = listCandidates()
  const wrong = rows.filter((r) => r.statusSince !== truth.get(r.id))
  assert('every row\'s statusSince matches its own latest history row', wrong.length === 0,
    wrong.map((r) => `${r.handle}: got ${r.statusSince}, expected ${truth.get(r.id)}`).join(' | '))
  const distinct = new Set(rows.map((r) => r.statusSince)).size
  assert('statusSince varies across candidates (not one collapsed value)',
    rows.length < 2 || distinct > 1, `all ${rows.length} rows share ${rows[0]?.statusSince}`)
}

// 7. Spend sum <= cap.
section('7. spend sum <= cap (Law 6, Part X)')
{
  const total = one<{ s: number | null }>('SELECT sum(amount) s FROM spend').s ?? 0
  assert(`total spend $${total.toFixed(2)} <= cap $${CAPS.total}`, total <= CAPS.total)
  for (const cat of ['serp', 'actors', 'llm'] as const) {
    const s = one<{ s: number | null }>('SELECT sum(amount) s FROM spend WHERE category=?', cat).s ?? 0
    assert(`${cat} spend $${s.toFixed(2)} <= cap $${CAPS[cat]}`, s <= CAPS[cat])
  }
}

// 8. Secondary dedupe — a flag, never an auto-merge (Part III).
section('8. secondary dedupe: shared link pages are flagged, never merged')
{
  // The dedupe key has exactly ONE definition, so this groups with the same
  // function the drawer uses. A second implementation here silently disagreed
  // with the app on query strings, so `check` could report a clean sheet on a
  // duplicate the UI was actively warning about. Independence is kept instead
  // by asserting that function against hand-written expectations below.
  const EXPECTED: [string, string | null][] = [
    ['https://stan.store/tara', 'stan.store/tara'],
    ['https://www.stan.store/tara/', 'stan.store/tara'],
    ['http://STAN.store/Tara', 'stan.store/tara'],
    ['stan.store/tara', 'stan.store/tara'],
    ['https://stan.store/tara?utm_source=ig', 'stan.store/tara'],
    ['https://stan.store/tara#offers', 'stan.store/tara'],
    ['  https://stan.store/tara  ', 'stan.store/tara'],
    ['https://linktr.ee/x/y', 'linktr.ee/x/y'],
    ['', null],
    ['   ', null],
  ]
  const wrong = EXPECTED.filter(([input, want]) => normalizeLinkUrl(input) !== want)
  assert('the link_url dedupe key normalizes as Part III intends', wrong.length === 0,
    wrong.map(([i, w]) => `${JSON.stringify(i)} -> ${JSON.stringify(normalizeLinkUrl(i))}, expected ${JSON.stringify(w)}`).join(' | '))

  const rows = q<{ id: number; handle: string; link_url: string | null }>('SELECT id, handle, link_url FROM candidates WHERE link_url IS NOT NULL')
  const byNorm = new Map<string, string[]>()
  for (const r of rows) {
    const norm = normalizeLinkUrl(r.link_url)
    if (!norm) continue
    byNorm.set(norm, [...(byNorm.get(norm) ?? []), r.handle])
  }
  const twins = [...byNorm.entries()].filter(([, hs]) => hs.length > 1)
  if (twins.length) twins.forEach(([norm, hs]) => warn('shared link page', `${norm}: ${hs.join(', ')} — merge by hand or leave separate`))
  else console.log('  ok    no shared link pages to flag')
}

// 9. The Observatory holds no duplicate readings (Law 9 makes them permanent).
section('9. observatory integrity — duplicate snapshots can never be removed (Law 9)')
{
  const dupes = q<{ handle: string; observed_at: string; c: number }>(
    'SELECT handle, observed_at, count(*) c FROM observations GROUP BY handle, observed_at HAVING c > 1 ORDER BY c DESC',
  )
  const total = one<{ c: number }>('SELECT count(*) c FROM observations').c
  if (dupes.length) {
    warn('duplicate observation snapshots',
      `${dupes.length} (handle, observed_at) pair(s) repeated across ${total} rows — e.g. ${dupes.slice(0, 3).map((d) => `${d.handle}@${d.observed_at}×${d.c}`).join(', ')}. These cannot be deleted; any panel average over them is skewed.`)
  } else {
    console.log(`  ok    ${total} snapshot(s), no duplicate readings`)
  }
}

// 10. The scoring prompts are the canon's fenced blocks, byte for byte.
section('10. prompts are verbatim canon (Part 6.1 / 6.2)')
{
  // Extracted the same way the files were generated: the first fenced block
  // after each section header in the blueprint. Any hand-edit to a prompt
  // file that is not first a canon edit turns this red.
  const canonLines = readFileSync('ANTENNA_BLUEPRINT.md', 'utf8').split('\n')
  const fenceAfter = (header: string): string | null => {
    const start = canonLines.findIndex((l) => l.startsWith(header))
    if (start < 0) return null
    const open = canonLines.findIndex((l, i) => i > start && l === '```')
    const close = canonLines.findIndex((l, i) => i > open && l === '```')
    if (open < 0 || close < 0) return null
    return canonLines.slice(open + 1, close).join('\n') + '\n'
  }
  for (const [file, header] of [
    ['prompts/prescore_v1.md', '## 6.1'],
    ['prompts/score_v1.md', '## 6.2'],
  ] as const) {
    const canon = fenceAfter(header)
    const onDisk = readFileSync(file, 'utf8')
    assert(`${file} matches the ${header} fence byte-for-byte`, canon !== null && onDisk === canon,
      canon === null ? 'fence not found in canon' : `differs at byte ${[...onDisk].findIndex((ch, i) => ch !== canon[i])}`)
  }
  const scorePrompt = readFileSync('prompts/score_v1.md', 'utf8')
  assert('score_v1.md still carries the {FEW_SHOT_BLOCK} slot', scorePrompt.includes('{FEW_SHOT_BLOCK}'))
  assert('score_v1.md still carries both metro placeholder slots',
    scorePrompt.includes('{NYC metro}') && scorePrompt.includes('{South Florida}'))

  // score_v2 (ratified A2): the RENDERED prompt — what the model actually
  // reads — must carry every metro term from config and leave no placeholder
  // unrendered. Metros stay config, never prompt text (Part 4.5).
  const rendered = renderScorePrompt(sqlite)
  const allTerms = [...METRO_TERMS.nyc, ...METRO_TERMS.sofla]
  const missingTerms = allTerms.filter((t) => !rendered.includes(t))
  assert(`rendered score prompt carries all ${allTerms.length} metro terms from config/metros.ts`,
    missingTerms.length === 0, `missing: ${missingTerms.join(', ')}`)
  const unrendered = ['{NYC metro}', '{South Florida}', '{FEW_SHOT_BLOCK}'].filter((s) => rendered.includes(s))
  assert('rendered score prompt has no unrendered placeholder braces', unrendered.length === 0, unrendered.join(', '))
  assert("score_prompt_version is 'score_v2'", SCORE_PROMPT_VERSION === 'score_v2', SCORE_PROMPT_VERSION)
}

// 11. The few-shot loop (Part 6.5): balanced, bounded, approve/reject only.
section('11. few-shot loop properties (Part 6.5)')
{
  const probePath = '/tmp/antenna-fewshot-probe.db'
  for (const suffix of ['', '-wal', '-shm']) rmSync(probePath + suffix, { force: true })
  runMigrations(probePath)
  const p = openSqlite(probePath)
  const at = new Date().toISOString()
  // 8 approves, 2 rejects, 1 bank, 1 flag — the block must balance, cap, and
  // exclude the non-training decisions.
  const mk = p.prepare(
    "INSERT INTO candidates (handle, source, first_seen, bio, follower_count, tier, score, created_at, updated_at) VALUES (?, 'check', ?, ?, 3000, 'A', 80, ?, ?)",
  )
  const rat = p.prepare('INSERT INTO ratifications (candidate_id, decision, reason, at) VALUES (?, ?, ?, ?)')
  for (let i = 0; i < 12; i++) {
    const info = mk.run(`fewshot.probe.${i}`, at, `probe bio ${i}`, at, at)
    const decision = i < 8 ? 'approve' : i < 10 ? 'reject' : i === 10 ? 'bank' : 'flag'
    rat.run(Number(info.lastInsertRowid), decision, decision === 'reject' ? 'not-selling' : `reason ${i}`, at)
  }
  const block = buildFewShotBlock(p)
  const approves = (block.match(/APPROVED @/g) ?? []).length
  const rejects = (block.match(/REJECTED @/g) ?? []).length
  assert('block balances: 5 approves despite 8 available', approves === 5, `${approves}`)
  assert('block keeps both rejects', rejects === 2, `${rejects}`)
  assert('bank and flag never train the scorer', !block.includes('fewshot.probe.10') && !block.includes('fewshot.probe.11'))
  assert("operator's reasons are carried into the examples", block.includes('not-selling'))
  assert('an empty table yields an empty block', buildFewShotBlock(openProbeEmpty()) === '')
  function openProbeEmpty() {
    p.exec('DELETE FROM ratifications')
    return p
  }
  p.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(probePath + suffix, { force: true })
}

// 12. Budget caps halt the pipeline (Law 6 / Part X).
section('12. budget caps live in code and halt (Law 6, Part X)')
{
  const probePath = '/tmp/antenna-budget-probe.db'
  for (const suffix of ['', '-wal', '-shm']) rmSync(probePath + suffix, { force: true })
  runMigrations(probePath)
  const p = openSqlite(probePath)
  const halted = (fn: () => void): string | null => {
    try { fn(); return null } catch (e) { return (e as Error).message }
  }
  const spendRow = p.prepare('INSERT INTO spend (at, category, amount, run_ref, note) VALUES (?, ?, ?, ?, ?)')
  const at = new Date().toISOString()

  spendRow.run(at, 'llm', CAPS.llm - 0.01, 'check', 'fill llm cap')
  const llmHalt = halted(() => ensureBudget('llm', 0.05, p))
  assert('llm category cap halts before the call', llmHalt !== null && llmHalt.includes('BUDGET HALT'), llmHalt ?? 'no halt')
  assert('under-cap calls pass', halted(() => ensureBudget('llm', 0.005, p)) === null)

  p.exec('DELETE FROM spend')
  spendRow.run(at, 'actors', CAPS.total - 0.01, 'check', 'simulated ledger overage')
  const totalHalt = halted(() => ensureBudget('llm', 0.05, p))
  assert('total campaign cap halts as the backstop', totalHalt !== null && totalHalt.includes(String(CAPS.total)), totalHalt ?? 'no halt')

  // A3: the harvest categories halt the same way (serp $25 / actors $100).
  p.exec('DELETE FROM spend')
  spendRow.run(at, 'serp', CAPS.serp - 0.005, 'check', 'fill serp cap')
  const serpHalt = halted(() => ensureBudget('serp', 0.01, p))
  assert('serp category cap halts a harvest run', serpHalt !== null && serpHalt.includes('BUDGET HALT'), serpHalt ?? 'no halt')
  p.exec('DELETE FROM spend')
  spendRow.run(at, 'actors', CAPS.actors - 0.005, 'check', 'fill actors cap')
  const actorsHalt = halted(() => ensureBudget('actors', 0.01, p))
  assert('actors category cap halts a harvest run', actorsHalt !== null && actorsHalt.includes('BUDGET HALT'), actorsHalt ?? 'no halt')
  p.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(probePath + suffix, { force: true })
}

// 13. Harvest (A3): DRAFT gates, Law 3, extraction, run-ledger integrity.
section('13. harvest — DRAFT gates, Law 3, extraction, ledger (Part IV / XV.8)')
{
  // Part XV.8: the starter libraries are red-penned before A3 runs them. Until
  // ratified, the DRAFT marker must exist in each config AND the real
  // providers must refuse. When ratification happens these assertions flip.
  for (const [file, marker] of [
    ['config/queries.ts', QUERY_LIBRARY_STATUS],
    ['config/hashtags.ts', HASHTAG_LIBRARY_STATUS],
    ['config/seeds.ts', SEED_LIST_STATUS],
  ] as const) {
    assert(`${file} carries the DRAFT marker (pending operator red-pen)`,
      marker.startsWith('DRAFT') && readFileSync(file, 'utf8').includes('DRAFT — pending ratification'),
      `status is "${marker}"`)
  }

  // The canon query templates are transcribed here from Part 4a by hand — the
  // config drifting from the blueprint's starter set must go red, exactly like
  // CANON_TRANSITIONS. (Ratified edits update both, deliberately.)
  const CANON_QUERY_TEMPLATES = [
    'site:stan.store ("online coach" OR "coaching") {metro_term}',
    'site:stan.store (fitness OR "personal trainer") {metro_term}',
    'site:linktr.ee "online fitness coach" {metro_term}',
    'site:linktr.ee ("apply" OR "coaching application") fitness {metro_term}',
    'site:beacons.ai fitness coach {metro_term}',
    'site:instagram.com "online coach" "{metro_term}" ("comment" OR "DM me")',
    'site:instagram.com fitness coach "{metro_term}" ("spots open" OR "apply")',
    '"1:1 coaching" fitness "{metro_term}" ("stan.store" OR "linktr.ee")',
  ]
  assert('query templates match the Part 4a starter set exactly',
    JSON.stringify([...QUERY_TEMPLATES]) === JSON.stringify(CANON_QUERY_TEMPLATES))

  // Law 3, as a predicate: the link fetcher must refuse Instagram hosts.
  assert('fetchLink refuses instagram.com (Law 3)', !isFetchableUrl('https://www.instagram.com/someone/'))
  assert('fetchLink refuses instagr.am (Law 3)', !isFetchableUrl('https://instagr.am/x'))
  assert('fetchLink allows ordinary link pages', isFetchableUrl('https://stan.store/x') && isFetchableUrl('https://linktr.ee/y'))

  // Extraction drift probes — fixed inputs, expected outputs.
  const page = 'Coaching by Dana. DM READY at instagram.com/dana.fit — 1:1 $299/mo, 12-week $1,200. ' +
    'Also @dana.backup and mail me at dana@gmail.com. Checkout via stan.store, Klarna ok. TikTok: tiktok.com/@danafit'
  const handles = extractHandles(page)
  assert('extractHandles: instagram.com link first, @mention second, email NOT a handle',
    handles[0] === 'dana.fit' && handles.includes('dana.backup') && !handles.includes('gmail.com'),
    JSON.stringify(handles))
  const prices = extractPrices(page)
  assert('extractPrices finds $299/mo and $1,200', prices.some((p2) => p2.includes('299')) && prices.some((p2) => p2.includes('1,200')), JSON.stringify(prices))
  const tells = extractPlatformTells(page)
  assert('platform tells: stan_store + klarna + tiktok_presence',
    tells.includes('stan_store') && tells.includes('klarna') && tells.includes('tiktok_presence'), JSON.stringify(tells))

  // Run-ledger integrity on the live DB (Law 4).
  const badRuns = q<{ id: number }>(
    "SELECT id FROM harvest_runs WHERE adapter IS NULL OR trim(adapter)='' OR started_at IS NULL",
  )
  assert('every harvest run carries adapter + started_at', badRuns.length === 0, `${badRuns.length} rows`)
  const overcount = q<{ id: number }>(
    'SELECT id FROM harvest_runs WHERE items_new > items_found',
  )
  assert('no run reports more inserts than finds', overcount.length === 0, overcount.map((r) => r.id).join(','))
  const knownSources = ['manual', 'serper', 'hashtags', 'commenters']
  const strays = q<{ source: string }>(
    `SELECT DISTINCT source FROM candidates WHERE source NOT IN (${knownSources.map((s) => `'${s}'`).join(',')})`,
  )
  assert('every candidate source is a known adapter or manual', strays.length === 0, strays.map((r) => r.source).join(','))
}

sqlite.close()

console.log(`\n${failures === 0 ? 'CHECK GREEN' : `CHECK RED — ${failures} failure(s)`}${warnings ? ` · ${warnings} warning(s)` : ''}`)
if (failures === 0) console.log('(npm run check chains check:canon and check:golden next — Part 2.6)')
process.exit(failures === 0 ? 0 : 1)
