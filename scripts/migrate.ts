/**
 * Migrate: apply drizzle-kit migrations, then (re)install the enforcement
 * triggers. Idempotent — safe to run on every boot.
 *
 * Never hand-edit the DB (Part 2.2). This script is the only door.
 */
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { DB_PATH, openSqlite } from '@/db/connection'
import { ENFORCEMENT_TRIGGERS, enforcementSql } from '@/db/enforcement'

const MIGRATIONS = './db/migrations'

export function runMigrations(path: string = DB_PATH): void {
  const sqlite = openSqlite(path)
  try {
    if (existsSync(MIGRATIONS)) {
      migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS })
    }
    sqlite.exec(enforcementSql())
    const installed = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='trigger'")
      .all() as { name: string }[]
    const names = new Set(installed.map((r) => r.name))
    const missing = ENFORCEMENT_TRIGGERS.filter((t) => !names.has(t))
    if (missing.length) throw new Error(`enforcement triggers missing: ${missing.join(', ')}`)
    console.log(`migrated ${path} · ${ENFORCEMENT_TRIGGERS.length} enforcement triggers installed`)
  } finally {
    sqlite.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMigrations()
}
