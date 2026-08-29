/**
 * `npm run state:export` — the durability export CLI.
 *
 * NOT the A4 `npm run export` the canon promises: that one is a lossy,
 * human-facing CSV of signed LOIs and funnel summary (the Ashok package, Part
 * 8.4), fired once when the 10th LOI signs. This one is a lossless,
 * machine-read snapshot fired every session and, since the ratify write-
 * through, on every decision. Two purposes, two commands.
 *
 * The mechanism lives in lib/stateExport.ts so this CLI and the /ratify
 * write-through cannot drift apart.
 *
 *   npm run state:export                     # write both artifacts
 *   npm run state:export -- --allow-lower    # move the mark DOWN, on purpose
 *
 * --allow-lower exists for exactly one situation: rows are gone because you
 * removed them (an erasure, a pruned table, a deliberate reseed). Without it
 * the export refuses rather than lowering the high-water mark, because the
 * commoner cause of "fewer rows than the census" is a container that was never
 * restored — and there, writing would destroy both the tripwire and the
 * snapshot that fixes it.
 */
import { CENSUS_PATH } from '@/lib/census'
import { DEFAULT_EXPORT_PATHS, SNAPSHOT_PATH, regressionReport, writeStateExport } from '@/lib/stateExport'
import { DB_PATH, openSqlite } from '@/db/connection'

const allowLower = process.argv.includes('--allow-lower')

const sqlite = openSqlite(DB_PATH)
const result = writeStateExport(sqlite, { allowLower })
sqlite.close()

if (!result.wrote) {
  console.error('')
  console.error(regressionReport(result.regressions, DEFAULT_EXPORT_PATHS))
  console.error('')
  process.exit(2)
}

const census = result.census

console.log('\nSTATE EXPORT\n')
if (allowLower) console.log('  --allow-lower: the mark may move DOWN on this run.\n')
console.log(`  ${CENSUS_PATH}   person-free · COMMITTED`)
console.log(`  ${SNAPSHOT_PATH}  person-linked · gitignored · hand this to the operator`)
console.log('')
for (const [t, n] of Object.entries(census.tables)) console.log(`  ${String(n).padStart(5)}  ${t}`)
console.log('')
console.log(
  `  spend floor: $${census.spend_floor.total.toFixed(4)} total ` +
  `(serp $${census.spend_floor.serp.toFixed(4)} · actors $${census.spend_floor.actors.toFixed(4)} · llm $${census.spend_floor.llm.toFixed(4)})`,
)
console.log('')
console.log('  The census is now the high-water mark: npm run check goes RED if this')
console.log('  database ever holds less than it records, and the export itself refuses')
console.log('  to lower it without --allow-lower.')
console.log('')
