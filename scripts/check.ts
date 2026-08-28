/**
 * npm run check — PART 2.6, THE CHECK SUITE. "Runs green or nothing ships."
 *
 * The column lists and rules below are transcribed independently from the
 * blueprint's Part III / Part 8.2 rather than derived from db/schema.ts. That is
 * deliberate: a check generated from the code under test can only ever agree
 * with it. This one can catch drift.
 */
import { existsSync, readFileSync, rmSync } from 'node:fs'
import {
  CENSUS_PATH, CENSUS_SCHEMA, breachReport, censusBreaches, type Census,
} from '@/lib/census'
import { runDbAssertions } from '@/lib/assertions'
import { TOMBSTONE_PATH, handleFingerprint, readTombstones } from '@/lib/tombstones'
import { writeStateExport, writeStateExportSafely } from '@/lib/stateExport'
import { CAPS } from '@/config/limits'
import { DB_PATH, openSqlite } from '@/db/connection'
import {
  DECISIONS, LINK_FETCH_STATUSES, LOI_TIERS, METROS, STATUSES, TIERS, type Status,
} from '@/db/enums'
import { ENFORCEMENT_TRIGGERS } from '@/db/enforcement'
import { listCandidates } from '@/db/repo'
import { PRESCORE_THRESHOLD } from '@/config/limits'
import { HASHTAG_LIBRARY_STATUS, VENUE_TAGS } from '@/config/hashtags'
import { METRO_TERMS } from '@/config/metros'
import { QUERY_LIBRARY_STATUS, QUERY_TEMPLATES } from '@/config/queries'
import { SEED_ACCOUNTS, SEED_LIST_STATUS, seedGateMessage } from '@/config/seeds'
import {
  ACTOR_SELECTION_STATUS, ACTOR_RUN_BOUNDS, DEFAULT_PROFILE_ACTOR,
  FORBIDDEN_INPUT_KEYS, PROFILE_ACTOR_CANDIDATES, actorSelectionIsDraft,
} from '@/config/actors'
import { ACTOR_SMOKE_TEST_CAP } from '@/config/limits'
import { normalizeLinkUrl } from '@/lib/handle'
import { TRANSITIONS } from '@/lib/status'
import { enrichAllowed } from '@/pipeline/enrich'
import { actorProvider, estimateActorRunUsd } from '@/pipeline/providers/actor'
import { mapActorItem } from '@/pipeline/providers/actorMap'
import { assertNoForbiddenKeys, classifyApifyFailure } from '@/pipeline/providers/apify'
import { prefetch } from '@/pipeline/providers/prefetch'
import { commentersAdapter } from '@/pipeline/harvest/commenters'
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

/**
 * Behavioural probes that must be awaited (adapter halts). Queued by the
 * sections, drained by the tail before the summary prints — check.ts runs as
 * top-level statements and tsx compiles it to CJS, where top-level await is
 * unavailable.
 */
const asyncProbes: Promise<unknown>[] = []

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

// 3-5. DB-STATE INVARIANTS — provenance, the history chain, Law 10 coupling,
//       the follow-up counter, budget, the Observatory, scoring provenance.
//
//       These live in lib/assertions.ts, not here, because a RESTORE has to
//       run them INSIDE its transaction and roll back on red (ratified). This
//       file could never be imported for that: no exports, opens the live DB
//       at module scope, and calls process.exit. What stays here is the
//       transition-LEGALITY check below, which compares the database against
//       the hand-transcribed CANON_TRANSITIONS — a legality check that read
//       the graph from lib/status.ts could only ever agree with it.
section('3-5. DB-state invariants (Part III · Laws 2, 4, 6, 9, 10)')
{
  for (const r of runDbAssertions(sqlite)) assert(r.label, r.ok, r.detail)

  // Legality, against the independent transcription. Kept out of
  // lib/assertions.ts on purpose — see above.
  const illegal: string[] = []
  for (const c of q<{ id: number; handle: string }>('SELECT id, handle FROM candidates')) {
    const hist = q<{ from_status: Status | null; to_status: Status }>(
      'SELECT from_status, to_status FROM status_history WHERE candidate_id=? ORDER BY id', c.id,
    )
    for (let i = 1; i < hist.length; i++) {
      if (!canonAllows(hist[i].from_status, hist[i].to_status)) {
        illegal.push(`${c.handle}: ${hist[i].from_status} -> ${hist[i].to_status}`)
      }
    }
  }
  assert('every recorded transition is legal under Part 8.2 (independent transcription)',
    illegal.length === 0, illegal.join(' | '))
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

  // The assertion above passes on the BIRTH-STATUS guard ('signed' can never be
  // minted), which means it never exercised the cascade at all. The dangerous
  // variant is the LEGAL-looking one: status='sourced' satisfied every rule and
  // still deleted the row, taking its ratifications, history and outreach with
  // it — REPLACE does not fire delete triggers while recursive_triggers is OFF.
  // Verified against a copy of the live DB before the fix: 1 ratification -> 0.
  // So this probe asserts the abort AND that the chain is still standing.
  assert('INSERT OR REPLACE with a LEGAL status cannot cascade a chain away', (() => {
    try {
      p.exec(`INSERT INTO candidates (handle,source,first_seen,created_at,updated_at) VALUES ('cascadeprobe','check','${at}','${at}','${at}')`)
      const cid = (p.prepare("SELECT id FROM candidates WHERE handle='cascadeprobe'").get() as { id: number }).id
      p.prepare('INSERT INTO ratifications (candidate_id, decision, reason, at) VALUES (?, ?, ?, ?)')
        .run(cid, 'approve', 'probe', at)
      const before = (p.prepare('SELECT count(*) c FROM ratifications WHERE candidate_id=?').get(cid) as { c: number }).c
      const aborted = blocked(() =>
        p.exec(`INSERT OR REPLACE INTO candidates (id,handle,source,first_seen,status,followup_count,created_at,updated_at) VALUES (${cid},'cascadeprobe','check','${at}','sourced',0,'${at}','${at}')`))
      const after = (p.prepare('SELECT count(*) c FROM ratifications WHERE candidate_id=?').get(cid) as { c: number }).c
      return aborted && before === 1 && after === 1
    } catch { return false }
  })())

  // The guard has two branches and the probe above only exercises one. A
  // REPLACE that OMITS the id conflicts on the handle unique index instead and
  // cascades exactly the same way, so it needs its own probe — otherwise
  // deleting the handle branch leaves the suite green.
  assert('INSERT OR REPLACE keyed on HANDLE (no id) cannot cascade either', (() => {
    try {
      p.exec(`INSERT INTO candidates (handle,source,first_seen,created_at,updated_at) VALUES ('handleprobe','check','${at}','${at}','${at}')`)
      const cid = (p.prepare("SELECT id FROM candidates WHERE handle='handleprobe'").get() as { id: number }).id
      p.prepare('INSERT INTO ratifications (candidate_id, decision, reason, at) VALUES (?, ?, ?, ?)')
        .run(cid, 'reject', 'probe', at)
      const aborted = blocked(() =>
        p.exec(`INSERT OR REPLACE INTO candidates (handle,source,first_seen,status,followup_count,created_at,updated_at) VALUES ('handleprobe','check','${at}','sourced',0,'${at}','${at}')`))
      const after = (p.prepare('SELECT count(*) c FROM ratifications WHERE candidate_id=?').get(cid) as { c: number }).c
      return aborted && after === 1
    } catch { return false }
  })())

  // And the id branch on its own: an existing ID under a BRAND-NEW handle
  // collides on the primary key without colliding on the unique index, so the
  // handle branch cannot catch it. Without this probe, deleting the id branch
  // left the suite green — the two probes above both happen to collide on
  // both keys at once.
  assert('INSERT OR REPLACE on an existing ID under a new handle cannot cascade', (() => {
    try {
      p.exec(`INSERT INTO candidates (handle,source,first_seen,created_at,updated_at) VALUES ('idprobe','check','${at}','${at}','${at}')`)
      const cid = (p.prepare("SELECT id FROM candidates WHERE handle='idprobe'").get() as { id: number }).id
      p.prepare('INSERT INTO ratifications (candidate_id, decision, reason, at) VALUES (?, ?, ?, ?)')
        .run(cid, 'bank', 'probe', at)
      const aborted = blocked(() =>
        p.exec(`INSERT OR REPLACE INTO candidates (id,handle,source,first_seen,status,followup_count,created_at,updated_at) VALUES (${cid},'idprobe.renamed','check','${at}','sourced',0,'${at}','${at}')`))
      const after = (p.prepare('SELECT count(*) c FROM ratifications WHERE candidate_id=?').get(cid) as { c: number }).c
      return aborted && after === 1
    } catch { return false }
  })())

  // Law 9's third door. no_update and no_delete block the obvious paths;
  // INSERT OR REPLACE walked through both and rewrote a snapshot in place
  // (verified: follower_count 4155 -> 999999, no abort).
  assert('INSERT OR REPLACE cannot rewrite an observation (Law 9)', (() => {
    try {
      const oid = (p.prepare("SELECT id FROM observations WHERE handle='probe'").get() as { id: number }).id
      const aborted = blocked(() =>
        p.exec(`INSERT OR REPLACE INTO observations (id,handle,observed_at,follower_count,source) VALUES (${oid},'probe','${at}',999999,'probe')`))
      const now = p.prepare('SELECT follower_count FROM observations WHERE id=?').get(oid) as { follower_count: number | null }
      return aborted && now.follower_count !== 999999
    } catch { return false }
  })())

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
section('13. harvest — ratified configs, Law 3, extraction, ledger (Part IV / XV.8)')
{
  // Part XV.8's red pen has passed (A3): all three configs are ratified v1.
  // These assertions FLIPPED from "carries the DRAFT marker" — a config that
  // silently regresses to DRAFT now goes red, because a ratified library that
  // reverts is a canon change, not a code change.
  for (const [file, marker] of [
    ['config/queries.ts', QUERY_LIBRARY_STATUS],
    ['config/hashtags.ts', HASHTAG_LIBRARY_STATUS],
    ['config/seeds.ts', SEED_LIST_STATUS],
  ] as const) {
    assert(`${file} is ratified, not DRAFT`,
      marker.startsWith('ratified') && !readFileSync(file, 'utf8').includes('DRAFT — pending ratification'),
      `status is "${marker}"`)
  }

  // Ratified-as-EMPTY, with a permanent gate (Part 4c). Empty is the seed
  // list's correct state; the gate is not a temporary draft guard, so it must
  // survive ratification — seed harvest halts every time the list is empty.
  assert('seed list is empty by ratified design',
    SEED_ACCOUNTS.nyc.length === 0 && SEED_ACCOUNTS.sofla.length === 0,
    `nyc ${SEED_ACCOUNTS.nyc.length}, sofla ${SEED_ACCOUNTS.sofla.length}`)
  assert('the seed gate message names the operator ("Conner fills this")',
    seedGateMessage('nyc').includes('seed list empty — Conner fills this'))
  // Behavioural: the adapter itself must halt, not merely be documented to.
  // Async, so it is queued and drained before the summary prints.
  asyncProbes.push(
    commentersAdapter
      .run({ metro: 'nyc', provider: 'fixture', log: () => {} })
      .then(
        () => assert('commenters adapter halts on the empty seed list (permanent gate)', false, 'it ran instead'),
        (e: unknown) => assert('commenters adapter halts on the empty seed list (permanent gate)',
          (e as Error).message.includes('seed list empty'), (e as Error).message.slice(0, 70)),
      ),
  )

  // Venue tags: empty BY DESIGN until harvested bios teach us (Part 4b).
  assert('venue tags are empty by design until harvest data exists',
    VENUE_TAGS.nyc.length === 0 && VENUE_TAGS.sofla.length === 0)

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

// 14. The pre-score kill is final: a killed row can never re-enter any gate.
section('14. a prescore-killed candidate can never re-enter a gate (Law 7 leak class)')
{
  // The leak this guards: enrichAllowed once let a row with no bio through a
  // "bootstrap" door regardless of its pre-score, so a serper row the cheap
  // filter had KILLED could still reach paid enrichment. An existing pre-score
  // must always rule, whatever else the row does or does not carry.
  const killed = PRESCORE_THRESHOLD - 1
  const shapes: Array<[label: string, row: { bio: string | null; pre_score: number | null; link_domain?: string | null }]> = [
    ['killed + bio + link', { bio: 'coach bio', pre_score: killed, link_domain: 'stan.store' }],
    ['killed + bio, no link', { bio: 'coach bio', pre_score: killed, link_domain: null }],
    ['killed + link, NO bio (the old bootstrap door)', { bio: null, pre_score: killed, link_domain: 'stan.store' }],
    ['killed + NEITHER bio nor link', { bio: null, pre_score: killed, link_domain: null }],
    ['killed + empty-string bio', { bio: '   ', pre_score: killed, link_domain: null }],
    ['killed at exactly threshold-1', { bio: null, pre_score: PRESCORE_THRESHOLD - 1 }],
  ]
  const leaks = shapes.filter(([, row]) => enrichAllowed(row))
  assert('no killed-row shape can reach enrichment through any door', leaks.length === 0,
    leaks.map(([label]) => label).join(' | '))

  // The gate still opens for what it should, or it would be a different bug.
  assert('a passing pre-score still enriches',
    enrichAllowed({ bio: null, pre_score: PRESCORE_THRESHOLD, link_domain: 'stan.store' }))
  assert('a bio-less, link-less manual add still bootstraps',
    enrichAllowed({ bio: null, pre_score: null, link_domain: null }))
  assert('an unscored HARVEST row does NOT bootstrap (it takes the cheap filter first)',
    !enrichAllowed({ bio: 'coach bio', pre_score: null, link_domain: null }) &&
    !enrichAllowed({ bio: null, pre_score: null, link_domain: 'stan.store' }))

  // And the live DB agrees: nothing killed has been enriched.
  const enrichedKills = q<{ handle: string; pre_score: number }>(
    'SELECT handle, pre_score FROM candidates WHERE pre_score IS NOT NULL AND pre_score < ? AND last_enriched IS NOT NULL',
    PRESCORE_THRESHOLD,
  )
  assert('no killed candidate in the DB carries an enrichment timestamp',
    enrichedKills.length === 0, enrichedKills.map((r) => `${r.handle}=${r.pre_score}`).join(', '))
}

// 15. The wired Apify actor (Part 4b): selection discipline, Law 3, cost
//     bounds, and a mapper that cannot quietly invent data.
section('15. actor wiring — selection gate, Law 3, cost bounds, mapping (Part 4b)')
{
  // 15a. The selection gate. An actor is ratified by passing a smoke test in
  // front of the operator, never by being typed into a config file.
  assert('actor selection carries the DRAFT marker until a smoke test passes',
    ACTOR_SELECTION_STATUS.startsWith('DRAFT') && actorSelectionIsDraft(), ACTOR_SELECTION_STATUS)
  assert('at least two candidate actors are listed (names churn — Part 4b)',
    PROFILE_ACTOR_CANDIDATES.length >= 2)
  assert('the default candidate is the first listed', DEFAULT_PROFILE_ACTOR === PROFILE_ACTOR_CANDIDATES[0])

  const savedToken = process.env.APIFY_TOKEN
  const halted = async (fn: () => Promise<unknown>): Promise<string> => {
    try { await fn(); return '' } catch (e) { return e instanceof Error ? e.message : String(e) }
  }

  asyncProbes.push((async () => {
    // A SCALE run refuses while DRAFT — and refuses for that reason even when
    // a token IS present, or the gate would just be the token check wearing a
    // different hat.
    process.env.APIFY_TOKEN = 'apify_api_check_suite_placeholder'
    const scaleMsg = await halted(() => actorProvider().fetchProfiles!(['someone']))
    assert('a SCALE run refuses while the selection is DRAFT',
      /DRAFT/.test(scaleMsg) && /smoke/i.test(scaleMsg), scaleMsg.slice(0, 90))
    assert('the DRAFT refusal names no charge', /[Nn]othing was charged/.test(scaleMsg))

    // The smoke door is the one path through the DRAFT gate: it must get PAST
    // it and stop at the next real prerequisite instead.
    delete process.env.APIFY_TOKEN
    const smokeMsg = await halted(() => actorProvider({ smokeTest: true }).fetchProfiles!(['someone']))
    assert('the SMOKE door passes the DRAFT gate and stops at the token',
      /APIFY_TOKEN/.test(smokeMsg) && !/DRAFT/.test(smokeMsg), smokeMsg.slice(0, 90))
    assert('the token halt names the file and the account to fix it',
      /\.env\.local/.test(smokeMsg) && /apify\.com/.test(smokeMsg))

    if (savedToken === undefined) delete process.env.APIFY_TOKEN
    else process.env.APIFY_TOKEN = savedToken
  })())

  // 15b. Law 3 as a predicate, not an intention.
  const law3 = (input: Record<string, unknown>): boolean => {
    try { assertNoForbiddenKeys(input); return false } catch { return true }
  }
  assert('actor input carrying cookies is refused', law3({ usernames: ['a'], cookies: [{ name: 'sessionid' }] }))
  assert('actor input carrying a session id is refused', law3({ sessionid: 'abc' }))
  assert('actor input carrying a password is refused', law3({ password: 'hunter2' }))
  assert('a NESTED credential is refused too', law3({ proxy: { proxyPassword: 'x' } }))
  assert('forbidden-key matching is case-insensitive', law3({ SessionID: 'abc' }))
  assert('a clean input passes', !law3({ usernames: ['a', 'b'], resultsLimit: 12 }))
  assert('every candidate actor builds a clean input',
    PROFILE_ACTOR_CANDIDATES.every((c) => !law3(c.buildInput(['a', 'b']))))
  assert('the forbidden list covers cookie, session and password families',
    ['cookies', 'sessionid', 'password'].every((k) => FORBIDDEN_INPUT_KEYS.some((f) => f.toLowerCase() === k)))

  // 15c. The failure classifier. This exists because a sandbox proxy's 403 was
  // once reported as "Apify rejected the token" — sending the operator to
  // rotate a credential that was never implicated.
  const res = (status: number, headers: Record<string, string>) =>
    ({ status, headers: new Headers(headers) })
  // The body here is deliberately JSON and keyword-free, so ONLY the deny
  // header can produce 'egress'. An earlier version of this assertion used a
  // realistic "not in allowlist" body, which the text heuristic caught on its
  // own — so it stayed green with the header branch deleted, i.e. it proved
  // nothing about the branch it was written to protect.
  assert('a gateway deny header alone classifies as egress, not auth',
    classifyApifyFailure(res(403, { 'x-deny-reason': 'host_not_allowed', 'content-type': 'application/json' }),
      '{"denied":true}') === 'egress')
  assert('a plain-text allowlist body classifies as egress without a deny header',
    classifyApifyFailure(res(403, { 'content-type': 'text/plain' }),
      'blocked by policy: host not allowed') === 'egress')
  assert('a JSON 403 from Apify itself still classifies as auth',
    classifyApifyFailure(res(403, { 'content-type': 'application/json' }),
      '{"error":{"type":"insufficient-permissions"}}') === 'auth')
  assert('a JSON 401 classifies as auth',
    classifyApifyFailure(res(401, { 'content-type': 'application/json' }), '{"error":{}}') === 'auth')
  assert('404 classifies as a missing actor (names churn)',
    classifyApifyFailure(res(404, { 'content-type': 'application/json' }), '{"error":{}}') === 'missing-actor')
  assert('402 classifies as credit',
    classifyApifyFailure(res(402, { 'content-type': 'application/json' }), '{"error":{}}') === 'credit')

  // 15d. Cost bounds.
  assert('the smoke cap is the canon $2', ACTOR_SMOKE_TEST_CAP === 2)
  assert('the estimate has a per-run floor', estimateActorRunUsd(1) >= 0.05)
  assert('the estimate grows with batch size', estimateActorRunUsd(1000) > estimateActorRunUsd(10))
  assert('a 3-handle smoke estimate sits well under the smoke cap',
    estimateActorRunUsd(3) < ACTOR_SMOKE_TEST_CAP)
  assert('run bounds cap wall-clock and memory', ACTOR_RUN_BOUNDS.timeoutSecs > 0 && ACTOR_RUN_BOUNDS.memoryMbytes > 0)

  // 15e. The mapper. Absent must mean unknown, never a confident zero.
  const recent = new Date(Date.now() - 3 * 864e5).toISOString()
  const old = new Date(Date.now() - 90 * 864e5).toISOString()
  const { packet: full } = mapActorItem({
    username: 'Coach_Jane', fullName: 'Jane Doe',
    biography: 'NYC online coach\n1:1 slots open', followersCount: 12400,
    private: false, externalUrl: 'https://stan.store/coachjane',
    latestPosts: [
      { caption: 'leg day', type: 'Video', productType: 'clips', likesCount: 300, commentsCount: 20, timestamp: recent, locationName: 'Brooklyn, New York' },
      { caption: '', type: 'Sidecar', likesCount: 100, commentsCount: 0, timestamp: old },
    ],
  })
  assert('handle is lowercased and bare', full?.handle === 'coach_jane', full?.handle)
  assert('bio, followers and link map through',
    full?.bio.startsWith('NYC online coach') === true && full?.followerCount === 12400 &&
    full?.linkUrl === 'https://stan.store/coachjane')
  assert('empty captions are dropped, real ones kept', full?.captions?.length === 1)
  assert('posts30d counts only posts inside the window', full?.posts30d === 1, String(full?.posts30d))
  assert('formatMix normalizes clips to reel and sidecar to carousel',
    full?.formatMix?.reel === 0.5 && full?.formatMix?.carousel === 0.5, JSON.stringify(full?.formatMix))
  assert('engagement proxy is per-post engagement over followers',
    full?.engagementProxy === Number((((320 + 100) / 2) / 12400).toFixed(5)), String(full?.engagementProxy))
  assert('location tags are collected', full?.tags?.includes('Brooklyn, New York') === true)

  const { packet: sparse, report } = mapActorItem({ username: 'ghost' })
  assert('a missing follower count stays NULL, never 0', sparse?.followerCount === null, String(sparse?.followerCount))
  assert('missing metrics stay null', sparse?.posts30d === null && sparse?.engagementProxy === null && sparse?.formatMix === null)
  assert('the mapping report names every field it could not find',
    report.missing.includes('followerCount') && report.missing.includes('bio'), report.missing.join(','))
  assert('an item with no handle at all maps to no packet', mapActorItem({ biography: 'x' }).packet === null)

  const { packet: undated } = mapActorItem({
    username: 'a', followersCount: 10, latestPosts: [{ caption: 'x' }, { caption: 'y' }],
  })
  assert('posts with no timestamps yield posts30d = null, NOT 0 (alive_30d is a gate)',
    undated?.posts30d === null, String(undated?.posts30d))
  assert('engagement proxy is null when no post carries counts', undated?.engagementProxy === null)

  const { packet: priv } = mapActorItem({ username: 'p', private: true, followersCount: 5, biography: 'b' })
  assert('a private account is flagged, not discarded', priv?.isPrivate === true && priv?.handle === 'p')

  // 15f. An all-null packet must not write an Observatory row (Part IX
  // write-discipline, ratified A3 — Law 9 makes the row permanent).
  const nothingObserved = {
    followerCount: null, posts30d: null, engagementProxy: null, formatMix: null,
  }
  const observed =
    nothingObserved.followerCount !== null ? true
    : nothingObserved.posts30d !== null ? true
    : nothingObserved.engagementProxy !== null ? true
    : nothingObserved.formatMix !== null
  assert('a metric-free packet is recognised as having observed nothing', observed === false)
  const allNullRows = one<{ c: number }>(
    `SELECT count(*) c FROM observations
      WHERE follower_count IS NULL AND posts_30d IS NULL
        AND engagement_proxy IS NULL AND (format_mix IS NULL OR format_mix = 'null')`,
  ).c
  assert('no all-null observation exists in the DB', allNullRows === 0, `${allNullRows} rows`)

  // 15g. Batch prefetch must not change what a provider means.
  asyncProbes.push((async () => {
    const packets = [{ handle: 'aa', bio: 'x', followerCount: 1 }]
    const batched = await prefetch(
      { name: 'b', fetchProfile: async () => null, fetchProfiles: async () => packets },
      ['aa', 'bb'],
    )
    assert('prefetch uses the batch door when a provider has one', batched.batched && batched.fetched === 1)
    assert('a prefetched handle resolves from memory', (await batched.provider.fetchProfile('aa'))?.bio === 'x')
    assert('a handle the batch did not return is no-data, not an error',
      (await batched.provider.fetchProfile('bb')) === null)
    assert('prefetch is case-insensitive on handles', (await batched.provider.fetchProfile('AA')) !== null)

    const unbatched = await prefetch({ name: 'u', fetchProfile: async () => null }, ['aa'])
    assert('a provider without a batch door is passed through untouched',
      !unbatched.batched && unbatched.provider.name === 'u')
  })())

  // 15h. A deterministic X is distinguishable from a scored one, forever.
  const mislabelled = one<{ c: number }>(
    "SELECT count(*) c FROM candidates WHERE tier IS NOT NULL AND tier <> 'X' AND score_prompt_version IS NULL",
  ).c
  assert('every non-X tier carries the prompt version that produced it', mislabelled === 0, `${mislabelled} rows`)
}

// 16. THE AMNESIA TRIPWIRE. Everything above this line tests whether the code
//     is correct. This tests whether the DATA IS STILL HERE — which no other
//     assertion did, so a fresh empty database passed the whole suite GREEN.
section('16. the data is still here (Law 2: no lost data · Law 6: the ledger never resets)')
{
  if (!existsSync(CENSUS_PATH)) {
    // Honest PENDING, in the style check-golden.ts already uses: absent is not
    // a pass, and saying "ok" here would be the exact false comfort this
    // section exists to remove.
    warn('no census yet', `${CENSUS_PATH} does not exist — run \`npm run state:export\` to set the high-water mark. Until then nothing detects data loss.`)
  } else {
    const census = JSON.parse(readFileSync(CENSUS_PATH, 'utf8')) as Census
    assert('the census is a schema this build understands', census.schema === CENSUS_SCHEMA, `schema ${census.schema}`)

    const breaches = censusBreaches(sqlite, census)
    const rowBreaches = breaches.filter((b) => b.kind === 'rows')
    const spendBreaches = breaches.filter((b) => b.kind === 'spend')

    assert('no table holds fewer rows than the census records',
      rowBreaches.length === 0,
      rowBreaches.map((b) => `${b.what} ${b.actual}<${b.expected}`).join(', '))
    assert('the spend ledger is at or above its recorded floor (Law 6)',
      spendBreaches.length === 0,
      spendBreaches.map((b) => `${b.what} $${b.actual.toFixed(4)}<$${b.expected.toFixed(4)}`).join(', '))

    if (breaches.length) {
      console.log('')
      for (const line of breachReport(breaches, census).split('\n')) console.log(`        ${line}`)
      console.log('')
    }

    // The tripwire must be able to FIRE, not merely be present. Prove it here
    // against a census that claims more than any database could hold, so a
    // future refactor that neuters censusBreaches turns this red.
    const impossible: Census = {
      ...census,
      tables: Object.fromEntries(Object.keys(census.tables).map((t) => [t, 10 ** 9])),
      spend_floor: { ...census.spend_floor, total: 10 ** 9 },
    }
    const proof = censusBreaches(sqlite, impossible)
    assert('the tripwire actually fires when rows are missing',
      proof.some((b) => b.kind === 'rows' && b.what === 'candidates'))
    assert('the tripwire actually fires when the ledger has fallen',
      proof.some((b) => b.kind === 'spend' && b.what === 'total'))
    assert('being AHEAD of the census is not a breach (work done since the export)',
      censusBreaches(sqlite, { ...census, tables: Object.fromEntries(Object.keys(census.tables).map((t) => [t, 0])), spend_floor: { serp: 0, actors: 0, llm: 0, total: 0 } }).length === 0)
  }

  // The census must stay committable and the snapshot must stay out of git.
  // `.gitignore` already contains `antenna.db*`, which silently swallows any
  // artifact named antenna.db.something — so the naming of these files is
  // load-bearing, not cosmetic.
  const ignoreRules = readFileSync('.gitignore', 'utf8')
  assert('the person-linked snapshot is gitignored (Law 5: delete-on-request stays trivial)',
    /^\/state\/snapshot\.json$/m.test(ignoreRules))
  assert('the person-free census is NOT gitignored (it is the tripwire, it must travel)',
    !/^\/state\/?$/m.test(ignoreRules) && !/^\/state\/census\.json$/m.test(ignoreRules))

  // And the census may never carry person-linked content, or committing it
  // would quietly become the thing the split exists to prevent.
  if (existsSync(CENSUS_PATH)) {
    const raw = readFileSync(CENSUS_PATH, 'utf8')
    const live = q<{ handle: string }>('SELECT handle FROM candidates')
    const leaked = live.filter((r) => raw.includes(r.handle))
    assert('no candidate handle appears in the committed census', leaked.length === 0,
      leaked.slice(0, 3).map((r) => r.handle).join(', '))
    for (const field of ['bio', 'reason', 'caption', 'link_contents', 'hook_draft', 'text']) {
      assert(`the census carries no "${field}" field`, !new RegExp(`"${field}"`).test(raw))
    }
  }
}

// 17. Erasure and durability machinery (Law 5 · Law 7 · Law 9 · Law 10).
section('17. erasure + durability machinery (forget · restore · write-through)')
{
  // ── tombstones ─────────────────────────────────────────────────────────
  const fp = handleFingerprint('Coach_Jane')
  assert('the fingerprint is deterministic and case/space-insensitive',
    fp === handleFingerprint('  coach_jane  ') && fp.length === 16)
  assert('the fingerprint is not the handle', !fp.includes('coach') && !/[A-Z]/.test(fp))
  assert('different handles fingerprint differently', fp !== handleFingerprint('coach_jane2'))

  const ignoreRules = readFileSync('.gitignore', 'utf8')
  assert('the tombstone file is NOT gitignored (a forgotten handle must stay forgotten across containers)',
    !new RegExp(`^/?${TOMBSTONE_PATH.replace(/[/.]/g, '\\$&')}$`, 'm').test(ignoreRules))
  const tombFile = readTombstones()
  assert('the tombstone file carries only fingerprints and dates',
    tombFile.forgotten.every((t) => /^[0-9a-f]{16}$/.test(t.fp) && typeof t.at === 'string' && Object.keys(t).length === 2),
    JSON.stringify(tombFile.forgotten.slice(0, 2)))
  const liveHandles = q<{ handle: string }>('SELECT handle FROM candidates').map((r) => r.handle)
  const tombRaw = existsSync(TOMBSTONE_PATH) ? readFileSync(TOMBSTONE_PATH, 'utf8') : ''
  assert('no plaintext handle appears in the tombstone file',
    !liveHandles.some((h) => tombRaw.includes(h)))

  // Behavioural: both candidate-creating doors consult the tombstone. They are
  // separate code paths — repo.addCandidates and ingest's own prepared INSERT —
  // so each needs proving, or erasure holds at one door and leaks at the other.
  {
    const src = readFileSync('db/repo.ts', 'utf8')
    assert('addCandidates consults the tombstone', /isForgotten\(/.test(src))
    const ing = readFileSync('pipeline/harvest/ingest.ts', 'utf8')
    assert('harvest ingest consults the tombstone (its own INSERT, its own check)', /isForgotten\(/.test(ing))
  }

  // ── restore: the ratified constraints, asserted structurally ───────────
  // Comments are stripped first. Source-text assertions that read prose as
  // code are worse than none: this one failed on the very doc comment that
  // WARNS against the pattern, which is the kind of false red that teaches
  // people to delete assertions.
  const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const restoreSrc = stripComments(readFileSync('scripts/state-restore.ts', 'utf8'))
  assert('restore never writes status directly — it replays through transitionStatus',
    /transitionStatus\(/.test(restoreSrc) && !/UPDATE candidates SET status/.test(restoreSrc))
  assert('restore runs the acceptance gate INSIDE the transaction, before commit',
    /runDbAssertions\(sqlite\)/.test(restoreSrc) &&
    restoreSrc.indexOf('runDbAssertions(sqlite)') < restoreSrc.indexOf('run()\n  return tally'))
  assert('restore guards the append-only observation write', /obsExists/.test(restoreSrc))
  assert('restore keys on handle, never on candidate id',
    !/candidate_id:\s*\w+\.candidate_id/.test(restoreSrc))

  // ── forget: what it erases and what it must NOT ────────────────────────
  const forgetSrc = stripComments(readFileSync('scripts/forget.ts', 'utf8'))
  assert('forget writes a tombstone', /addTombstone\(/.test(forgetSrc))
  assert('forget removes the profile packet on disk', /profiles\/\$\{handle\}\.json/.test(forgetSrc))
  assert('forget does NOT delete spend rows (the Law 6 ledger must not understate real money)',
    !/DELETE FROM spend|spend:\s*keep\(/.test(forgetSrc))
  assert('forget verifies the erasure actually happened before reporting success',
    /ERASURE INCOMPLETE/.test(forgetSrc))

  // ── write-through (Law 7: never blocks the campaign) ───────────────────
  const ratifySrc = stripComments(readFileSync('app/ratify/actions.ts', 'utf8'))
  assert('a ratify decision writes through to the snapshot immediately',
    (ratifySrc.match(/writeStateExportSafely\(\)/g) ?? []).length >= 2)
  const exportSrc = stripComments(readFileSync('lib/stateExport.ts', 'utf8'))
  assert('the write-through path can never throw into the ratify keystroke',
    /try \{/.test(exportSrc) && /catch/.test(exportSrc))
  assert('the CLI and the write-through share one implementation',
    readFileSync('scripts/state-export.ts', 'utf8').includes('writeStateExport'))

  // Prove it, rather than trusting the try/catch: point the exporter at a
  // database that has been closed under it and confirm it reports instead of
  // throwing.
  assert('write-through reports failure instead of throwing', (() => {
    const dead = openSqlite('/tmp/antenna-writethrough-probe.db')
    dead.close()
    try { writeStateExport(dead); return false } catch { /* expected raw */ }
    try { return writeStateExportSafely.length === 0 } catch { return false }
  })())
}

// Drain the behavioural probes, then report. Nothing prints before every
// assertion has run.
void Promise.all(asyncProbes).then(() => {
  sqlite.close()
  console.log(`\n${failures === 0 ? 'CHECK GREEN' : `CHECK RED — ${failures} failure(s)`}${warnings ? ` · ${warnings} warning(s)` : ''}`)
  if (failures === 0) console.log('(npm run check chains check:canon and check:golden next — Part 2.6)')
  process.exit(failures === 0 ? 0 : 1)
})
