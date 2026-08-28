/**
 * `npm run state:verify -- --against=<db>` — prove a restored database is
 * equivalent to this one in every way that matters.
 *
 * "Equivalent" deliberately excludes autoincrement ids, which are re-minted by
 * design and are exactly why the snapshot is handle-keyed. It includes the
 * thing most likely to break silently: buildFewShotBlock(), whose output is
 * the scorer's calibration. If a restore changes WHICH of Conner's judgments
 * teach the model, the pipeline gets quietly worse with nothing to show for
 * it — so that block is compared byte for byte.
 */
import { openSqlite } from '@/db/connection'
import { runDbAssertions } from '@/lib/assertions'
import { readCensusFrom } from '@/lib/census'
import { buildFewShotBlock } from '@/prompts/fewshot'

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=')

let fails = 0
const ok = (label: string, pass: boolean, detail = '') => {
  console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${!pass && detail ? ` — ${detail}` : ''}`)
  if (!pass) fails++
}

function main(): void {
  const otherPath = arg('against')
  if (!otherPath) throw new Error('usage: npm run state:verify -- --against=<path to restored db>')

  const a = openSqlite('./antenna.db')
  const b = openSqlite(otherPath)

  console.log(`\nSTATE VERIFY — ./antenna.db  vs  ${otherPath}\n`)

  // 1. census equality (row counts + money)
  const ca = readCensusFrom(a, ''), cb = readCensusFrom(b, '')
  for (const t of Object.keys(ca.tables)) {
    ok(`${t} row count matches (${ca.tables[t]})`, ca.tables[t] === cb.tables[t], `${ca.tables[t]} vs ${cb.tables[t]}`)
  }
  ok('spend total matches', ca.spend_floor.total === cb.spend_floor.total,
    `${ca.spend_floor.total} vs ${cb.spend_floor.total}`)

  // 2. every invariant holds on the restored side
  const failed = runDbAssertions(b).filter((r) => !r.ok)
  ok('every DB invariant holds on the restored database', failed.length === 0,
    failed.map((f) => f.label).join('; '))

  // 3. per-candidate content equality, keyed on handle
  const cols = [
    'handle', 'name', 'follower_count', 'bio', 'link_url', 'link_domain', 'link_fetch_status',
    'metro', 'metro_confidence', 'source', 'source_detail', 'first_seen', 'last_enriched',
    'pre_score', 'score', 'tier', 'score_prompt_version', 'score_failed', 'status',
    'followup_count', 'loi_tier', 'notes', 'next_action_date',
  ]
  const rowsOf = (db: ReturnType<typeof openSqlite>) =>
    new Map((db.prepare(`SELECT ${cols.join(',')} FROM candidates ORDER BY handle`).all() as Record<string, unknown>[])
      .map((r) => [String(r.handle), r]))
  const ra = rowsOf(a), rb = rowsOf(b)
  const drift: string[] = []
  for (const [handle, rowA] of ra) {
    const rowB = rb.get(handle)
    if (!rowB) { drift.push(`${handle}: missing`); continue }
    for (const c of cols) {
      if (JSON.stringify(rowA[c]) !== JSON.stringify(rowB[c])) {
        drift.push(`${handle}.${c}: ${JSON.stringify(rowA[c])} vs ${JSON.stringify(rowB[c])}`)
      }
    }
  }
  ok('every candidate column matches, handle by handle', drift.length === 0, drift.slice(0, 4).join(' | '))

  // 4. the funnel, hop for hop
  const histOf = (db: ReturnType<typeof openSqlite>) =>
    (db.prepare(
      `SELECT c.handle, h.from_status, h.to_status, h.at, h.note
         FROM status_history h JOIN candidates c ON c.id=h.candidate_id
        ORDER BY c.handle, h.at, h.to_status`,
    ).all() as Record<string, unknown>[]).map((r) => JSON.stringify(r))
  const ha = histOf(a), hb = histOf(b)
  ok(`status_history matches hop for hop (${ha.length})`, JSON.stringify(ha) === JSON.stringify(hb),
    `${ha.length} vs ${hb.length}`)

  // 5. ratifications, decision for decision
  const ratOf = (db: ReturnType<typeof openSqlite>) =>
    (db.prepare(
      `SELECT c.handle, r.decision, r.reason, r.at FROM ratifications r
         JOIN candidates c ON c.id=r.candidate_id ORDER BY r.at, c.handle`,
    ).all() as Record<string, unknown>[]).map((r) => JSON.stringify(r))
  ok('ratifications match, decision for decision', JSON.stringify(ratOf(a)) === JSON.stringify(ratOf(b)))

  // 6. THE ONE THAT MATTERS MOST — same few-shot block, byte for byte.
  const fa = buildFewShotBlock(a), fb = buildFewShotBlock(b)
  ok('buildFewShotBlock is byte-identical (the scorer calibrates the same)', fa === fb,
    fa === fb ? '' : `\n--- live ---\n${fa.slice(0, 300)}\n--- restored ---\n${fb.slice(0, 300)}`)

  // 7. observations, the append-only panel
  const obsOf = (db: ReturnType<typeof openSqlite>) =>
    (db.prepare('SELECT handle, observed_at, follower_count, posts_30d, engagement_proxy, source FROM observations ORDER BY handle, observed_at, source').all() as Record<string, unknown>[])
      .map((r) => JSON.stringify(r))
  ok('the observation panel matches snapshot for snapshot',
    JSON.stringify(obsOf(a)) === JSON.stringify(obsOf(b)))

  a.close(); b.close()
  console.log(`\n${fails === 0 ? 'STATE VERIFY GREEN — the restore is equivalent' : `STATE VERIFY RED — ${fails} difference(s)`}\n`)
  process.exit(fails === 0 ? 0 : 1)
}

main()
