/**
 * npm run backup — Part X. Timestamped copy of antenna.db into
 * ~/Backups/antenna/ (the iCloud-synced folder). Run at the end of every
 * operating session; it belongs in the session-close habit (Part XIV).
 *
 * Uses SQLite's online backup API, not a file copy: with WAL on, `cp` can
 * capture a torn database.
 */
import { mkdirSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { DB_PATH, openSqlite } from '@/db/connection'

const DEST_DIR = process.env.ANTENNA_BACKUP_DIR ?? join(homedir(), 'Backups', 'antenna')

function stampNow(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

async function main() {
  if (!existsSync(DB_PATH)) {
    console.error(`no database at ${DB_PATH} — nothing to back up. Run npm run migrate first.`)
    process.exit(1)
  }
  mkdirSync(DEST_DIR, { recursive: true })
  const dest = join(DEST_DIR, `antenna-${stampNow()}.db`)

  const sqlite = openSqlite(DB_PATH)
  try {
    await sqlite.backup(dest)
  } finally {
    sqlite.close()
  }

  const size = statSync(dest).size
  const kept = readdirSync(DEST_DIR).filter((f) => f.startsWith('antenna-') && f.endsWith('.db')).length
  console.log(`backed up -> ${dest} (${(size / 1024).toFixed(0)} KB)`)
  console.log(`${kept} backup${kept === 1 ? '' : 's'} in ${DEST_DIR}`)
}

void main()
