/**
 * `npm run forget -- <handle>` — Law 5's delete-on-request, actually available.
 *
 * Law 5 has promised "trivial delete-on-request" since A1 and the system could
 * not do it: the only `DELETE FROM candidates` anywhere in the tree was in the
 * seed script. Every durability copy we add multiplies data we cannot erase,
 * so erasure ships in the same phase as the copies.
 *
 * WHY THIS REBUILDS RATHER THAN DELETES. Observations are append-only by
 * trigger (Law 9) — there is no DELETE path, deliberately, and dropping the
 * trigger to make one would dissolve the guarantee for every other writer too.
 * So the erasure path is: snapshot, filter the person out of the snapshot,
 * rebuild the database from what remains. That satisfies both laws at once,
 * and it cannot happen by accident: it is a whole-database rebuild, gated by
 * every invariant in lib/assertions.ts before it commits.
 *
 * What is erased: the candidate row and its bio/captions/link text, its
 * history, ratifications, outreach and observations, and the profile packet on
 * disk. What remains: a person-free tombstone (a handle fingerprint and a
 * date) so harvest does not re-collect them next week — see lib/tombstones.ts
 * for exactly what that fingerprint is and is not worth.
 *
 * Money is NOT erased. Spend rows carry no handle, and deleting them would
 * make the Law 6 ledger lie about what was actually charged.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { DB_PATH, openSqlite } from '@/db/connection'
import { PipelineHalt } from '@/lib/env'
import { normalizeHandle } from '@/lib/handle'
import { addTombstone, handleFingerprint, isForgotten } from '@/lib/tombstones'
import type { Snapshot } from './state-restore'

const FILTERED = 'state/.forget-filtered.json'

function positional(): string | undefined {
  return process.argv.slice(2).find((a) => !a.startsWith('--'))
}

function main(): void {
  const raw = positional()
  if (!raw) {
    throw new PipelineHalt('usage: npm run forget -- <handle>   (the handle to erase, with or without @)')
  }
  const handle = normalizeHandle(raw)
  if (!handle) throw new PipelineHalt(`"${raw}" is not a usable Instagram handle.`)

  const dryRun = process.argv.includes('--dry-run')

  // ── what is actually held about this person ─────────────────────────────
  const sqlite = openSqlite(DB_PATH)
  const row = sqlite.prepare('SELECT id, handle, bio FROM candidates WHERE handle = ?').get(handle) as
    { id: number; handle: string; bio: string | null } | undefined
  const counts = row
    ? {
        ratifications: (sqlite.prepare('SELECT count(*) c FROM ratifications WHERE candidate_id=?').get(row.id) as { c: number }).c,
        status_history: (sqlite.prepare('SELECT count(*) c FROM status_history WHERE candidate_id=?').get(row.id) as { c: number }).c,
        outreach_log: (sqlite.prepare('SELECT count(*) c FROM outreach_log WHERE candidate_id=?').get(row.id) as { c: number }).c,
        observations: (sqlite.prepare('SELECT count(*) c FROM observations WHERE handle=?').get(handle) as { c: number }).c,
      }
    : { ratifications: 0, status_history: 0, outreach_log: 0, observations: 0 }
  sqlite.close()

  const packet = `profiles/${handle}.json`
  const hasPacket = existsSync(packet)

  console.log(`\nFORGET @${handle}  (fingerprint ${handleFingerprint(handle)})\n`)
  console.log(`  candidate row:    ${row ? 'present' : 'not in this database'}`)
  console.log(`  bio held:         ${row?.bio ? `${row.bio.length} chars` : 'none'}`)
  for (const [k, v] of Object.entries(counts)) console.log(`  ${(k + ':').padEnd(18)}${v}`)
  console.log(`  profile packet:   ${hasPacket ? packet : 'none'}`)
  console.log(`  already forgotten:${isForgotten(handle) ? ' yes (tombstone exists)' : ' no'}`)
  console.log('')

  if (dryRun) {
    console.log('  --dry-run: nothing was changed.\n')
    return
  }

  // ── 1. export current state, then filter this person out of it ──────────
  execFileSync('npx', ['tsx', 'scripts/state-export.ts'], { stdio: 'ignore' })
  const snap = JSON.parse(readFileSync('state/snapshot.json', 'utf8')) as Snapshot
  const keep = <T extends Record<string, unknown>>(rows: T[]): T[] => rows.filter((r) => r.handle !== handle)

  const filtered: Snapshot = {
    ...snap,
    candidates: keep(snap.candidates),
    ratifications: keep(snap.ratifications),
    status_history: keep(snap.status_history),
    outreach_log: keep(snap.outreach_log),
    observations: keep(snap.observations),
    // spend and harvest_runs are person-free and stay — erasing them would
    // make the Law 6 ledger understate real money.
  }
  writeFileSync(FILTERED, JSON.stringify(filtered, null, 2))

  // ── 2. tombstone BEFORE the rebuild ─────────────────────────────────────
  // Order matters: the restore's own addCandidates() consults the tombstone,
  // so writing it first means the rebuild physically cannot reintroduce them,
  // belt and braces with the filtered snapshot.
  addTombstone(handle, new Date().toISOString())
  console.log(`  tombstone written (person-free: fingerprint + date)`)

  // ── 3. rebuild from what remains, in a child process ────────────────────
  // A child, because the database file is deleted and re-migrated and this
  // process already holds an open handle to it.
  console.log('  rebuilding the database without this person…')
  execFileSync('npx', ['tsx', 'scripts/state-restore.ts', '--fresh', `--snapshot=${FILTERED}`], {
    stdio: ['ignore', 'pipe', 'inherit'],
  })

  // ── 4. the packet on disk ───────────────────────────────────────────────
  if (hasPacket) { rmSync(packet, { force: true }); console.log(`  deleted ${packet}`) }
  rmSync(FILTERED, { force: true })

  // ── 5. move the census to the new truth ─────────────────────────────────
  execFileSync('npx', ['tsx', 'scripts/state-export.ts'], { stdio: 'ignore' })

  const after = openSqlite(DB_PATH)
  const still = (after.prepare('SELECT count(*) c FROM candidates WHERE handle=?').get(handle) as { c: number }).c
  const stillObs = (after.prepare('SELECT count(*) c FROM observations WHERE handle=?').get(handle) as { c: number }).c
  after.close()

  console.log('')
  if (still || stillObs) {
    throw new PipelineHalt(
      `ERASURE INCOMPLETE — ${still} candidate row(s) and ${stillObs} observation(s) for @${handle} survived the rebuild.`,
    )
  }
  console.log(`  @${handle} is gone: 0 candidate rows, 0 observations, packet removed.`)
  console.log('  The tombstone keeps them out of the next harvest.')
  console.log('  Re-export your snapshot and hand it to yourself — the old one still has them.\n')
}

try {
  main()
} catch (e) {
  if (e instanceof PipelineHalt) { console.error(`\n■ ${e.message}\n`); process.exit(2) }
  throw e
}
