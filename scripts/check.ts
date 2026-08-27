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
import { STATUSES, type Status } from '@/db/enums'
import { ENFORCEMENT_TRIGGERS } from '@/db/enforcement'
import { listCandidates } from '@/db/repo'
import { canTransition } from '@/lib/status'
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
    const cols = new Set(q<{ name: string }>(`PRAGMA table_info(${table})`).map((r) => r.name))
    const missing = CANON_COLUMNS[table].filter((c) => !cols.has(c))
    assert(`table ${table} carries every Part III column`, missing.length === 0, `missing: ${missing.join(', ')}`)
  }
  const enumsSrc = readFileSync('db/enums.ts', 'utf8')
  for (const [name, values] of Object.entries(CANON_ENUMS)) {
    const present = values.every((v) => enumsSrc.includes(`'${v}'`))
    assert(`enum ${name} strings verbatim`, present, `expected ${values.join(' | ')}`)
  }
  assert('STATUSES matches Part III exactly', JSON.stringify([...STATUSES]) === JSON.stringify(CANON_ENUMS.status))

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

  for (const c of cands) {
    const hist = q<{ from_status: Status | null; to_status: Status }>(
      'SELECT from_status, to_status FROM status_history WHERE candidate_id=? ORDER BY id', c.id,
    )
    if (!hist.length) { chainBreaks.push(`${c.handle}: no history at all`); continue }
    if (hist[0].from_status !== null) noGenesis.push(c.handle)
    // Walk the chain: each row's from_status must equal the previous to_status,
    // each hop must be legal, and the last to_status must equal the live status.
    for (let i = 1; i < hist.length; i++) {
      if (hist[i].from_status !== hist[i - 1].to_status) {
        chainBreaks.push(`${c.handle}: ${hist[i - 1].to_status} then from=${hist[i].from_status}`)
      }
      if (!canTransition(hist[i].from_status as Status, hist[i].to_status)) {
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
  assert('raw SQL cannot insert an uppercase handle', blocked(() =>
    p.exec(`INSERT INTO candidates (handle,source,first_seen,created_at,updated_at) VALUES ('Probe2','check','${at}','${at}','${at}')`)))
  assert('a raw status UPDATE still writes history', (() => {
    p.exec("UPDATE candidates SET status='qualified' WHERE handle='probe'")
    const h = p.prepare("SELECT count(*) c FROM status_history WHERE to_status='qualified'").get() as { c: number }
    return h.c === 1
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
  const rows = q<{ id: number; handle: string; link_url: string | null }>('SELECT id, handle, link_url FROM candidates WHERE link_url IS NOT NULL')
  const byNorm = new Map<string, string[]>()
  for (const r of rows) {
    const norm = (r.link_url ?? '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '').toLowerCase()
    if (!norm) continue
    byNorm.set(norm, [...(byNorm.get(norm) ?? []), r.handle])
  }
  const twins = [...byNorm.entries()].filter(([, hs]) => hs.length > 1)
  if (twins.length) twins.forEach(([norm, hs]) => warn('shared link page', `${norm}: ${hs.join(', ')} — merge by hand or leave separate`))
  else console.log('  ok    no shared link pages to flag')
}

sqlite.close()

console.log(`\n${failures === 0 ? 'CHECK GREEN' : `CHECK RED — ${failures} failure(s)`}${warnings ? ` · ${warnings} warning(s)` : ''}`)
if (failures === 0) console.log('(npm run check chains check:golden next — Part 2.6)')
process.exit(failures === 0 ? 0 : 1)
