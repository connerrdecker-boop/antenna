/**
 * `npm run state:pull` — THE FIRST COMMAND IN A FRESH CONTAINER.
 *
 * Fetches the state the last session pushed and restores the database from it.
 * This is the documented first step of every new session: the local database
 * and state/snapshot.json are both gitignored (Law 5, Part 2.3), so a rebuilt
 * container starts with a correct repo and an empty world. `npm run check`
 * would report GREEN over zero candidates, which is the silent amnesia the
 * census was built to make loud — and the census can only shout AFTER the
 * fact. This is the fix rather than the alarm.
 *
 *   npm run state:pull                 # fetch, then restore into a fresh DB
 *   npm run state:pull -- --fetch-only # write the files, do not touch the DB
 *   npm run state:pull -- --dry-run    # report what the store holds
 *
 * The restore itself is unchanged and still gated: it replays history through
 * transitionStatus and runs every invariant INSIDE the transaction, rolling
 * back on red. Pulling cannot import a shape the live system could not have
 * produced.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { CENSUS_PATH } from '@/lib/census'
import { loadEnvLocal, PipelineHalt } from '@/lib/env'
import { getRecord, listKeys, resolveStore, STATE_STORE_NAME, STORE_KEYS } from '@/lib/remoteStore'
import {
  CALIBRATION_ARTIFACT_PATH as ARTIFACT_PATH,
  CALIBRATION_PACKETS_PATH as PACKETS_PATH,
  SNAPSHOT_PATH,
} from '@/lib/stateExport'
import { TOMBSTONE_PATH } from '@/lib/tombstones'
import { restoreFromSnapshot, type Snapshot } from './state-restore'
import { runMigrations } from './migrate'
import { DB_PATH } from '@/db/connection'
import { rmSync } from 'node:fs'

const flag = (n: string) => process.argv.includes(`--${n}`)

const KEY_TO_PATH: Record<string, string> = {
  [STORE_KEYS.snapshot]: SNAPSHOT_PATH,
  [STORE_KEYS.census]: CENSUS_PATH,
  [STORE_KEYS.tombstones]: TOMBSTONE_PATH,
  [STORE_KEYS.calibrationBatch]: ARTIFACT_PATH,
  [STORE_KEYS.calibrationPackets]: PACKETS_PATH,
}

async function main() {
  loadEnvLocal()

  const store = await resolveStore()
  const keys = await listKeys(store)

  console.log(`\nSTATE PULL ← Apify key-value store "${STATE_STORE_NAME}"\n`)
  if (!keys.length) {
    throw new PipelineHalt(
      `The store "${STATE_STORE_NAME}" is empty — there is nothing to pull.\n\n` +
      'If this is the first run, push from a session that has state: npm run state:push\n' +
      'If it is NOT, the store was emptied; do not run anything that spends until that is understood.',
    )
  }
  console.log(`  holds: ${keys.join(', ')}\n`)

  if (flag('dry-run')) {
    console.log('  DRY RUN — nothing fetched, nothing written.\n')
    return
  }

  // Write every record we recognise back to its canonical path.
  let snapshot: Snapshot | null = null
  for (const key of Object.keys(KEY_TO_PATH)) {
    if (!keys.includes(key)) continue
    const value = await getRecord(store, key)
    if (value === null) continue
    const path = KEY_TO_PATH[key]
    mkdirSync(path.slice(0, path.lastIndexOf('/')) || '.', { recursive: true })
    writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
    console.log(`  ${key.padEnd(22)} -> ${path}`)
    if (key === STORE_KEYS.snapshot) snapshot = value as Snapshot
  }

  if (flag('fetch-only')) {
    console.log('\n  --fetch-only: files written, database untouched.')
    console.log('  Restore when ready: npm run state:restore -- --fresh\n')
    return
  }
  if (!snapshot) {
    throw new PipelineHalt(
      `The store has no "${STORE_KEYS.snapshot}" record, so there is nothing to restore the database from. ` +
      'The other files were written. Push a snapshot from a session that has one.',
    )
  }

  // Same door as `state:restore -- --fresh`: wipe, migrate, replay, gate.
  for (const suffix of ['', '-wal', '-shm']) rmSync(DB_PATH + suffix, { force: true })
  runMigrations(DB_PATH)
  console.log(`\n  wiped and re-migrated ${DB_PATH}`)

  const tally = restoreFromSnapshot(snapshot)
  console.log('\n  restored:')
  for (const [k, v] of Object.entries(tally)) console.log(`    ${String(v).padStart(5)}  ${k}`)
  console.log('\n  every invariant passed inside the transaction before it committed.')
  console.log('  verify with: npm run check\n')
}

main().catch((e: unknown) => {
  if (e instanceof PipelineHalt) {
    console.error(`\n■ ${e.message}\n`)
    process.exit(2)
  }
  console.error(e)
  process.exit(1)
})
