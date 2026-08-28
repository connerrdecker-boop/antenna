/**
 * THE CENSUS — the tripwire that makes data loss LOUD.
 *
 * The failure this exists for, verified: a fresh container migrates a fresh
 * database, prints "migrated · 14 enforcement triggers installed", and
 * `npm run check` reports CHECK GREEN over zero candidates and zero
 * ratifications. Nothing anywhere says the work is gone. Law 2 claims "no lost
 * data" as an ENGINEERED guarantee; silent amnesia is the precise way that
 * claim goes false.
 *
 * So the census is a committed, PERSON-FREE high-water mark: row counts per
 * table plus the money floor. It carries no handle, no bio, no reason text —
 * nothing Law 5 governs — which is why it can live in git with no privacy
 * question to settle first.
 *
 * Two properties it enforces, both one-directional:
 *   1. Tables never shrink. Fewer rows than the census means loss, not health.
 *   2. Spend never falls. Law 6 makes overspend "structurally impossible" via
 *      SUM(spend) + estimate <= cap. A reset ledger silently re-authorises the
 *      whole cap — money already spent at the provider, forgotten here. The
 *      floor is what stops a rebuilt container spending it twice.
 */
import type BetterSqlite3 from 'better-sqlite3'
import { SPEND_CATEGORIES, type SpendCategory } from '@/db/enums'

export const CENSUS_PATH = 'state/census.json'
export const CENSUS_SCHEMA = 1

/** Every table the census counts. Order is stable so the file diffs cleanly. */
export const CENSUS_TABLES = [
  'candidates', 'ratifications', 'observations', 'outreach_log',
  'status_history', 'spend', 'harvest_runs',
] as const

export type Census = {
  schema: number
  written_at: string
  /** Row counts at the high-water mark. */
  tables: Record<string, number>
  /** Money already spent, per category plus total. Monotonic: only ever rises. */
  spend_floor: Record<string, number>
}

export function readCensusFrom(sqlite: BetterSqlite3.Database, at: string): Census {
  const tables: Record<string, number> = {}
  for (const t of CENSUS_TABLES) {
    tables[t] = (sqlite.prepare(`SELECT count(*) c FROM ${t}`).get() as { c: number }).c
  }

  const spend_floor: Record<string, number> = {}
  for (const cat of SPEND_CATEGORIES) {
    spend_floor[cat] = round(
      (sqlite.prepare('SELECT COALESCE(SUM(amount), 0) s FROM spend WHERE category = ?').get(cat) as { s: number }).s,
    )
  }
  spend_floor.total = round(
    (sqlite.prepare('SELECT COALESCE(SUM(amount), 0) s FROM spend').get() as { s: number }).s,
  )

  return { schema: CENSUS_SCHEMA, written_at: at, tables, spend_floor }
}

const round = (n: number) => Number(n.toFixed(6))

export type CensusBreach = {
  kind: 'rows' | 'spend'
  what: string
  expected: number
  actual: number
}

/**
 * Compare a live database against a committed census. Returns every place the
 * live DB is BEHIND the mark. Ahead is fine and expected — that is just work
 * done since the last export.
 *
 * A previous census that is newer than the DB is the signature of a reclaimed
 * container: the file survived in git, the database did not.
 */
export function censusBreaches(sqlite: BetterSqlite3.Database, census: Census): CensusBreach[] {
  const breaches: CensusBreach[] = []
  const live = readCensusFrom(sqlite, '')

  for (const t of CENSUS_TABLES) {
    const expected = census.tables[t] ?? 0
    const actual = live.tables[t] ?? 0
    if (actual < expected) breaches.push({ kind: 'rows', what: t, expected, actual })
  }

  for (const key of [...SPEND_CATEGORIES, 'total'] as (SpendCategory | 'total')[]) {
    const expected = census.spend_floor[key] ?? 0
    const actual = live.spend_floor[key] ?? 0
    // Float tolerance: spend is summed real money, not an integer count.
    if (actual + 1e-6 < expected) breaches.push({ kind: 'spend', what: key, expected, actual })
  }

  return breaches
}

/** The operator-facing explanation. Written once, used by check and by the CLI. */
export function breachReport(breaches: CensusBreach[], census: Census): string {
  const rows = breaches.filter((b) => b.kind === 'rows')
  const money = breaches.filter((b) => b.kind === 'spend')
  const lines: string[] = [
    `The committed census (${CENSUS_PATH}, written ${census.written_at}) records state this database does not have.`,
    '',
  ]
  if (rows.length) {
    lines.push('MISSING ROWS:')
    for (const b of rows) lines.push(`  ${b.what.padEnd(16)} census ${b.expected}, live ${b.actual}  (${b.expected - b.actual} gone)`)
    lines.push('')
  }
  if (money.length) {
    lines.push('SPEND LEDGER BELOW ITS FLOOR (Law 6):')
    for (const b of money) lines.push(`  ${b.what.padEnd(16)} floor $${b.expected.toFixed(4)}, live $${b.actual.toFixed(4)}`)
    lines.push('')
    lines.push('  A ledger that forgets money already spent re-authorises the whole cap.')
    lines.push('  Restore before running anything that spends.')
    lines.push('')
  }
  lines.push('If this container was rebuilt: restore from the state export before working.')
  lines.push('If the loss was deliberate (a seed reset, a pruned table): re-run `npm run state:export`')
  lines.push('to move the mark, which is a decision you are making on purpose rather than one')
  lines.push('the tool made quietly for you.')
  return lines.join('\n')
}
