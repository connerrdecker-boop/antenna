/**
 * npm run check:golden — Part 6.6. Re-scores golden/set.json against the
 * current prompt + few-shot block and asserts >=90% A-vs-not-A tier agreement.
 *
 * The golden set is hand-labeled in phase A2, after the calibration run. Until
 * that file exists this reports PENDING rather than pretending to pass: a
 * regression test with no fixtures is not a green check.
 */
import { existsSync } from 'node:fs'

const SET = 'golden/set.json'

if (!existsSync(SET)) {
  console.log('golden set: PENDING')
  console.log(`  ${SET} does not exist yet — it is hand-labeled in phase A2 (30 profiles: ~10 A, 10 B/C, 10 X).`)
  console.log('  Until then there is nothing to regress against. This is not a pass.')
  process.exit(0)
}

console.error('golden set: NOT IMPLEMENTED')
console.error(`  ${SET} exists but the scorer arrives in phase A2. Refusing to report a pass.`)
process.exit(1)
