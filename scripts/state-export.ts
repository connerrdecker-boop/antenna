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
 */
import { CENSUS_PATH } from '@/lib/census'
import { SNAPSHOT_PATH, writeStateExport } from '@/lib/stateExport'
import { DB_PATH, openSqlite } from '@/db/connection'

const sqlite = openSqlite(DB_PATH)
const census = writeStateExport(sqlite)
sqlite.close()

console.log('\nSTATE EXPORT\n')
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
console.log('  database ever holds less than it records.')
console.log('')
