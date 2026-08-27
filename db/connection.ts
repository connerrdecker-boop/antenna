/**
 * The one SQLite handle. Local file DB, single user, localhost only (Part X).
 * Shared across Next.js hot reloads via a global so dev never opens N handles.
 */
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

export const DB_PATH = process.env.ANTENNA_DB ?? './antenna.db'

export function openSqlite(path: string = DB_PATH): Database.Database {
  const sqlite = new Database(path)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  // Enforcement triggers must never re-enter each other (db/enforcement.ts).
  sqlite.pragma('recursive_triggers = OFF')
  return sqlite
}

type Holder = { sqlite?: Database.Database; drizzle?: ReturnType<typeof drizzle<typeof schema>> }
const holder: Holder = ((globalThis as Record<string, unknown>).__antennaDb ??= {}) as Holder

export function getSqlite(): Database.Database {
  return (holder.sqlite ??= openSqlite())
}

export function getDb() {
  return (holder.drizzle ??= drizzle(getSqlite(), { schema }))
}
