/**
 * `npm run state:export` — the durability export.
 *
 * NOT the same thing as the A4 `npm run export` the canon promises: that one is
 * a lossy, human-facing CSV of signed LOIs and funnel summary (the Ashok
 * package, Part 8.4), fired once when the 10th LOI signs. This one is a
 * lossless, machine-read snapshot fired every session. Two purposes, two
 * commands.
 *
 * It writes TWO artifacts, split on the Law 5 line:
 *
 *   state/census.json     PERSON-FREE — row counts and the money floor.
 *                         COMMITTED. No handle, no bio, no reason text, so
 *                         there is no Law 5 question to settle before it can
 *                         live in git. This is what makes loss loud.
 *
 *   state/snapshot.json   PERSON-LINKED — all seven tables, handle-keyed.
 *                         GITIGNORED. It leaves the container by being handed
 *                         to the operator, who holds it wherever the Part X
 *                         backup habit points. Keeping it out of git history
 *                         is what keeps Law 5's "trivial delete-on-request"
 *                         honest: deleting a row from a file the operator
 *                         holds is trivial; deleting it from git history is a
 *                         history rewrite, and calling that trivial would be a
 *                         lie.
 *
 * Handle-keyed, never id-keyed: candidate ids are autoincrement and re-minted
 * in every fresh container (this database currently runs 262+, a fresh
 * migrate+seed starts at 1), so an id-keyed export restores onto the wrong
 * people or onto nobody.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { CENSUS_PATH, readCensusFrom } from '@/lib/census'
import { DB_PATH, openSqlite } from '@/db/connection'

const SNAPSHOT_PATH = 'state/snapshot.json'

type Row = Record<string, unknown>

function main(): void {
  const sqlite = openSqlite(DB_PATH)
  const at = new Date().toISOString()
  const all = (sql: string): Row[] => sqlite.prepare(sql).all() as Row[]

  mkdirSync('state', { recursive: true })

  // ---- the committed, person-free half -----------------------------------
  const census = readCensusFrom(sqlite, at)
  writeFileSync(CENSUS_PATH, JSON.stringify(census, null, 2) + '\n')

  // ---- the operator-held, person-linked half ------------------------------
  // Every child table carries the candidate's HANDLE, not its id.
  const snapshot = {
    schema: 1,
    written_at: at,
    candidates: all('SELECT * FROM candidates ORDER BY handle'),
    ratifications: all(
      `SELECT c.handle, r.decision, r.reason, r.at
         FROM ratifications r JOIN candidates c ON c.id = r.candidate_id
        ORDER BY r.at, r.id`,
    ),
    status_history: all(
      `SELECT c.handle, h.from_status, h.to_status, h.at, h.note
         FROM status_history h JOIN candidates c ON c.id = h.candidate_id
        ORDER BY h.at, h.id`,
    ),
    outreach_log: all(
      `SELECT c.handle, o.direction, o.text, o.at
         FROM outreach_log o JOIN candidates c ON c.id = o.candidate_id
        ORDER BY o.at, o.id`,
    ),
    // observations key on handle already (Part IX is a per-handle panel).
    observations: all('SELECT * FROM observations ORDER BY observed_at, id'),
    spend: all('SELECT * FROM spend ORDER BY at, id'),
    harvest_runs: all('SELECT * FROM harvest_runs ORDER BY started_at, id'),
  }
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2) + '\n')

  sqlite.close()

  const n = (t: string) => String(census.tables[t] ?? 0).padStart(5)
  console.log('\nSTATE EXPORT\n')
  console.log(`  ${CENSUS_PATH}   person-free · COMMITTED`)
  console.log(`  ${SNAPSHOT_PATH}  person-linked · gitignored · hand this to the operator`)
  console.log('')
  for (const t of Object.keys(census.tables)) console.log(`  ${n(t)}  ${t}`)
  console.log('')
  console.log(`  spend floor: $${census.spend_floor.total.toFixed(4)} total ` +
    `(serp $${census.spend_floor.serp.toFixed(4)} · actors $${census.spend_floor.actors.toFixed(4)} · llm $${census.spend_floor.llm.toFixed(4)})`)
  console.log('')
  console.log('  The census is now the high-water mark: npm run check goes RED if this')
  console.log('  database ever holds less than it records.')
  console.log('')
}

main()
