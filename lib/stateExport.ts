/**
 * The durability export, as a function — so the CLI and the ratify write-
 * through path produce the SAME two artifacts from the same code. Two writers
 * that could drift is exactly how a backup quietly stops matching the thing it
 * backs up.
 *
 * The Law 5 split, enforced by which file gets which data:
 *   state/census.json    person-free, COMMITTED. Counts and money.
 *   state/snapshot.json  person-linked, GITIGNORED. Handed to the operator.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import type BetterSqlite3 from 'better-sqlite3'
import { getSqlite } from '@/db/connection'
import { CENSUS_PATH, readCensusFrom, type Census } from './census'

export const SNAPSHOT_PATH = 'state/snapshot.json'

type Row = Record<string, unknown>

export function writeStateExport(sqlite: BetterSqlite3.Database = getSqlite()): Census {
  const at = new Date().toISOString()
  const all = (sql: string): Row[] => sqlite.prepare(sql).all() as Row[]

  mkdirSync('state', { recursive: true })

  const census = readCensusFrom(sqlite, at)
  writeFileSync(CENSUS_PATH, JSON.stringify(census, null, 2) + '\n')

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
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2) + '\n')

  return census
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
 */
export function writeStateExportSafely(): { ok: true } | { ok: false; error: string } {
  try {
    writeStateExport()
    return { ok: true }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.error(`[durability] state export failed after a ratify decision: ${error}`)
    return { ok: false, error }
  }
}
