/**
 * `npm run state:push` — upload local state to the remote store.
 *
 * Runs at every milestone, and on every ratify keystroke through the
 * write-through in lib/stateExport.ts. What goes up:
 *
 *   snapshot             person-linked, the thing a rebuild is made of
 *   census               person-free, the tripwire
 *   tombstones           person-free fingerprints; a forget must stay forgotten
 *   calibration-batch    per-candidate judgments + the model's own claim
 *   calibration-packets  recovered captions, so a rebuild never re-charges
 *
 * The snapshot is EXPORTED first rather than read off disk. Pushing a stale
 * file would be worse than not pushing: it would look like durability and
 * restore yesterday's state.
 *
 *   npm run state:push
 *   npm run state:push -- --dry-run    # show what would go, send nothing
 */
import { existsSync, readFileSync } from 'node:fs'
import { CENSUS_PATH } from '@/lib/census'
import { loadEnvLocal, PipelineHalt } from '@/lib/env'
import { resolveStore, putRecord, STATE_STORE_NAME, STORE_KEYS } from '@/lib/remoteStore'
import {
  CALIBRATION_ARTIFACT_PATH as ARTIFACT_PATH,
  CALIBRATION_PACKETS_PATH as PACKETS_PATH,
  DEFAULT_EXPORT_PATHS, regressionReport, SNAPSHOT_PATH, writeStateExport,
} from '@/lib/stateExport'
import { TOMBSTONE_PATH } from '@/lib/tombstones'

const flag = (n: string) => process.argv.includes(`--${n}`)

const readJson = (path: string): unknown | null =>
  existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as unknown) : null

export async function pushState(opts: { dryRun?: boolean; quiet?: boolean } = {}): Promise<
  { key: string; bytes: number }[]
> {
  const log = (s: string) => { if (!opts.quiet) console.log(s) }

  // Export FIRST: the store must never carry a snapshot older than the DB.
  // The ratchet can refuse; pushing anyway would ship the very regression it
  // just declined to write locally.
  const exported = writeStateExport()
  if (!exported.wrote) {
    throw new PipelineHalt(regressionReport(exported.regressions, DEFAULT_EXPORT_PATHS))
  }

  const payloads: { key: string; value: unknown }[] = []
  const add = (key: string, value: unknown | null) => { if (value !== null) payloads.push({ key, value }) }
  add(STORE_KEYS.snapshot, readJson(SNAPSHOT_PATH))
  add(STORE_KEYS.census, readJson(CENSUS_PATH))
  add(STORE_KEYS.tombstones, readJson(TOMBSTONE_PATH))
  add(STORE_KEYS.calibrationBatch, readJson(ARTIFACT_PATH))
  add(STORE_KEYS.calibrationPackets, readJson(PACKETS_PATH))

  if (opts.dryRun) {
    log(`\nDRY RUN — would push ${payloads.length} record(s) to "${STATE_STORE_NAME}":`)
    for (const p of payloads) {
      log(`  ${p.key.padEnd(22)} ${Buffer.byteLength(JSON.stringify(p.value)).toLocaleString()} bytes`)
    }
    log('')
    return []
  }

  const store = await resolveStore()
  const written: { key: string; bytes: number }[] = []
  for (const p of payloads) {
    written.push({ key: p.key, bytes: await putRecord(store, p.key, p.value) })
  }
  return written
}

async function main() {
  loadEnvLocal()
  const written = await pushState({ dryRun: flag('dry-run') })
  if (!written.length) return

  console.log(`\nSTATE PUSH → Apify key-value store "${STATE_STORE_NAME}" (named · persists)\n`)
  for (const w of written) console.log(`  ${w.key.padEnd(22)} ${w.bytes.toLocaleString()} bytes`)
  console.log('\n  The store is now the primary durability layer for this state.')
  console.log('  A fresh container starts with: npm run state:pull\n')
}

if (require.main === module) {
  main().catch((e: unknown) => {
    if (e instanceof PipelineHalt) {
      console.error(`\n■ ${e.message}\n`)
      process.exit(2)
    }
    console.error(e)
    process.exit(1)
  })
}
