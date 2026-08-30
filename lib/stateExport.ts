/**
 * The durability export, as a function — so the CLI and the ratify write-
 * through path produce the SAME two artifacts from the same code. Two writers
 * that could drift is exactly how a backup quietly stops matching the thing it
 * backs up.
 *
 * The Law 5 split, enforced by which file gets which data:
 *   state/census.json    person-free, COMMITTED. Counts and money.
 *   state/snapshot.json  person-linked, GITIGNORED. Handed to the operator.
 *
 * THE RATCHET (added after the clobber bug). The census is a HIGH-WATER MARK,
 * and a high-water mark that any writer can lower is not a mark at all — it is
 * a mirror. The bug: `npm run check` called this function to prove the census
 * was byte-stable, which on a container whose database had not been restored
 * yet rewrote the committed census down to zero AND overwrote the operator's
 * only snapshot with an empty one. The tripwire disarmed itself, and the file
 * that would have rearmed it went with it.
 *
 * So an export is now ATOMIC AND ONE-DIRECTIONAL: if the live database is
 * BEHIND the committed census on any table or any spend category, neither file
 * is written. Refusing to write is recoverable; overwriting the only copy of
 * person-linked data with a degraded one is not. Lowering the mark is still
 * possible — `npm run state:export -- --allow-lower`, and `npm run forget`
 * uses it — but only as something the operator asks for by name.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type BetterSqlite3 from 'better-sqlite3'
import { getSqlite } from '@/db/connection'
import { SPEND_CATEGORIES } from '@/db/enums'
import { CENSUS_PATH, CENSUS_TABLES, readCensusFrom, type Census } from './census'
import { putRecord, resolveStore, STORE_KEYS } from './remoteStore'
import { TOMBSTONE_PATH } from './tombstones'

export const SNAPSHOT_PATH = 'state/snapshot.json'
/**
 * The calibration run's artifacts. They live here, beside SNAPSHOT_PATH,
 * because they are durability paths and `lib/` may not import from `scripts/`.
 * scripts/calibrate.ts re-exports them under its own names.
 */
export const CALIBRATION_ARTIFACT_PATH = 'state/calibration/batch.json'
export const CALIBRATION_PACKETS_PATH = 'state/calibration/packets.json'

/** Where an export writes. Overridable so probes can exercise it on scratch files. */
export type ExportPaths = { census: string; snapshot: string }
export const DEFAULT_EXPORT_PATHS: ExportPaths = { census: CENSUS_PATH, snapshot: SNAPSHOT_PATH }

export type ExportOptions = {
  paths?: ExportPaths
  /**
   * Deliberately move the mark DOWN. Set only by an operator asking for it
   * (`--allow-lower`) or by `npm run forget`, whose whole job is to remove
   * rows on purpose. Never defaulted true.
   */
  allowLower?: boolean
}

/** One place the live database sits below the committed mark. */
export type CensusRegression = {
  kind: 'rows' | 'spend'
  what: string
  committed: number
  live: number
}

export type ExportResult = {
  /** The census on disk after the call — the prior one if the write was refused. */
  census: Census
  wrote: boolean
  /** Non-empty exactly when the write was refused. */
  regressions: CensusRegression[]
}

type Row = Record<string, unknown>

/**
 * Where `fresh` sits below `prior`. Empty means the export is safe to write.
 *
 * Deliberately its own exported function rather than a closure: the check
 * suite proves the ratchet by calling this directly, and a rule that can only
 * be tested through its side effects is a rule that quietly stops being tested.
 */
export function censusRegressions(prior: Census | null, fresh: Census): CensusRegression[] {
  if (!prior) return []
  const out: CensusRegression[] = []
  for (const t of CENSUS_TABLES) {
    const committed = prior.tables[t] ?? 0
    const live = fresh.tables[t] ?? 0
    if (live < committed) out.push({ kind: 'rows', what: t, committed, live })
  }
  for (const key of [...SPEND_CATEGORIES, 'total']) {
    const committed = prior.spend_floor[key] ?? 0
    const live = fresh.spend_floor[key] ?? 0
    // Float tolerance: spend is summed real money, not an integer count.
    if (live + 1e-6 < committed) out.push({ kind: 'spend', what: key, committed, live })
  }
  return out
}

/** The operator-facing explanation for a refused export. */
export function regressionReport(regressions: CensusRegression[], paths: ExportPaths): string {
  const lines = [
    `EXPORT REFUSED — this database is behind ${paths.census}, so writing would lower the mark.`,
    '',
  ]
  for (const r of regressions) {
    lines.push(
      r.kind === 'rows'
        ? `  ${r.what.padEnd(16)} census ${r.committed}, live ${r.live}  (${r.committed - r.live} gone)`
        : `  spend ${r.what.padEnd(10)} floor $${r.committed.toFixed(4)}, live $${r.live.toFixed(4)}`,
    )
  }
  lines.push('')
  lines.push(`Neither ${paths.census} nor ${paths.snapshot} was written. The high-water mark`)
  lines.push('still stands and your existing snapshot is untouched.')
  lines.push('')
  lines.push('If the container was rebuilt:  npm run state:restore -- --fresh')
  lines.push('If the loss was on purpose:    npm run state:export -- --allow-lower')
  return lines.join('\n')
}

export function writeStateExport(
  sqlite: BetterSqlite3.Database = getSqlite(),
  opts: ExportOptions = {},
): ExportResult {
  const paths = opts.paths ?? DEFAULT_EXPORT_PATHS
  const at = new Date().toISOString()
  const all = (sql: string): Row[] => sqlite.prepare(sql).all() as Row[]

  // Read the database BEFORE creating any directory or touching any file, so a
  // dead handle fails with nothing half-written behind it.
  const fresh = readCensusFrom(sqlite, at)

  const prior = existsSync(paths.census)
    ? (JSON.parse(readFileSync(paths.census, 'utf8')) as Census)
    : null

  // ── THE RATCHET ────────────────────────────────────────────────────────
  const regressions = opts.allowLower ? [] : censusRegressions(prior, fresh)
  if (regressions.length) {
    // prior is non-null whenever regressions is non-empty (censusRegressions
    // returns [] for a null prior), so the mark on disk is what we return.
    return { census: prior as Census, wrote: false, regressions }
  }

  mkdirSync('state', { recursive: true })

  // The census is COMMITTED and rewritten on every ratify keystroke, so a
  // fresh `written_at` on every call would leave a modified file in git status
  // after every single decision. Substance-only writes: the timestamp then
  // means "when the recorded state last CHANGED", which is the question anyone
  // reading it actually has, and an unchanged census stays byte-identical.
  const sameSubstance = prior !== null &&
    JSON.stringify(prior.tables) === JSON.stringify(fresh.tables) &&
    JSON.stringify(prior.spend_floor) === JSON.stringify(fresh.spend_floor)
  const census = sameSubstance ? prior : fresh
  if (!sameSubstance) writeFileSync(paths.census, JSON.stringify(census, null, 2) + '\n')

  // Every child table carries the candidate's HANDLE, never its id: ids are
  // autoincrement and re-minted in a rebuilt container, so an id-keyed export
  // restores onto the wrong people or onto nobody.
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
    observations: all('SELECT * FROM observations ORDER BY observed_at, id'),
    spend: all('SELECT * FROM spend ORDER BY at, id'),
    harvest_runs: all('SELECT * FROM harvest_runs ORDER BY started_at, id'),
  }
  writeFileSync(paths.snapshot, JSON.stringify(snapshot, null, 2) + '\n')

  return { census, wrote: true, regressions: [] }
}

/**
 * Write-through for the operator's ratify hour (ratified): every decision
 * lands in the snapshot the moment it is made, not at the next milestone.
 * That hour is the highest-value data this system will ever hold and the only
 * data no amount of money can reproduce.
 *
 * NEVER THROWS. Law 7 — the tool never blocks the campaign. A failed export is
 * a real problem, but a ratify keystroke that errors because a disk write
 * failed would be a worse one, and the census tripwire in npm run check is
 * what surfaces a durability failure loudly anyway.
 *
 * A RATCHET REFUSAL is reported the same way, and for the same reason: a
 * database sitting below its own census is a container that was never
 * restored, which `npm run check` is already shouting about. Losing one
 * write-through there is strictly better than overwriting the snapshot that
 * would have fixed it.
 */
export function writeStateExportSafely(): { ok: true } | { ok: false; error: string } {
  try {
    const result = writeStateExport()
    if (!result.wrote) {
      const error = regressionReport(result.regressions, DEFAULT_EXPORT_PATHS)
      console.error(`[durability] state export refused after a ratify decision:\n${error}`)
      return { ok: false, error }
    }
    // The remote store is the primary durability layer (ratified 2026-08-30),
    // so the ratify hour reaches it too — a decision that only ever landed in
    // a gitignored local file is one container reclaim away from being gone.
    //
    // Deliberately NOT awaited: this is a network round trip sitting on the
    // operator's keystroke path and Law 7 says the tool never blocks the
    // campaign. It is also deliberately AFTER the regression guard above, so
    // a refused export never ships a regressed snapshot to the store.
    void pushExportedStateSafely()
    return { ok: true }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.error(`[durability] state export failed after a ratify decision: ${error}`)
    return { ok: false, error }
  }
}

/**
 * Upload whatever the last export wrote. Reads the FILES rather than the
 * database, so the store can never disagree with what writeStateExport()
 * actually produced — and so the regression guard's refusal is honoured
 * rather than routed around.
 */
export async function pushExportedState(): Promise<{ key: string; bytes: number }[]> {
  const store = await resolveStore()
  const records: [string, string][] = [
    [STORE_KEYS.snapshot, SNAPSHOT_PATH],
    [STORE_KEYS.census, CENSUS_PATH],
    [STORE_KEYS.tombstones, TOMBSTONE_PATH],
    [STORE_KEYS.calibrationBatch, CALIBRATION_ARTIFACT_PATH],
    [STORE_KEYS.calibrationPackets, CALIBRATION_PACKETS_PATH],
  ]
  const written: { key: string; bytes: number }[] = []
  for (const [key, path] of records) {
    if (!existsSync(path)) continue
    written.push({ key, bytes: await putRecord(store, key, JSON.parse(readFileSync(path, 'utf8'))) })
  }
  return written
}

/**
 * NEVER THROWS and never rejects — the same contract as
 * writeStateExportSafely(), for the same Law 7 reason. A failed push is a real
 * problem, and both `npm run state:pull` and the census will surface it; a
 * ratify keystroke that errored because a network call failed would be worse.
 */
export async function pushExportedStateSafely(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await pushExportedState()
    return { ok: true }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.error(`[durability] remote state push failed (the local export is intact): ${error}`)
    return { ok: false, error }
  }
}
