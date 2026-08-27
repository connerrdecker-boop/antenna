/**
 * PART X — BUDGET ENFORCEMENT. Law 6: budget caps live in code; the pipeline
 * halts itself; overspend is structurally impossible.
 *
 * Before ANY paid call: SUM(spend) + estimate <= CAP_TOTAL, and the category's
 * own sum + estimate <= its cap. Exceed either -> halt with a clear message.
 * Every paid run writes a spend row.
 */
import type BetterSqlite3 from 'better-sqlite3'
import { CAPS } from '@/config/limits'
import { getSqlite } from '@/db/connection'
import type { SpendCategory } from '@/db/enums'
import { PipelineHalt } from '@/lib/env'

const usd = (n: number) => `$${n.toFixed(2)}`

export function spentTotal(sqlite: BetterSqlite3.Database = getSqlite()): number {
  return (sqlite.prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM spend').get() as { s: number }).s
}

export function spentIn(category: SpendCategory, sqlite: BetterSqlite3.Database = getSqlite()): number {
  return (sqlite.prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM spend WHERE category = ?').get(category) as { s: number }).s
}

/**
 * The gate. Throws PipelineHalt — never returns false — so no caller can
 * forget to check a boolean.
 */
export function ensureBudget(
  category: SpendCategory,
  estimate: number,
  sqlite: BetterSqlite3.Database = getSqlite(),
): void {
  const catSpent = spentIn(category, sqlite)
  const catCap = CAPS[category]
  if (catSpent + estimate > catCap) {
    throw new PipelineHalt(
      `BUDGET HALT (Part X): the ${category} category has spent ${usd(catSpent)} of its ${usd(catCap)} cap; ` +
      `this call's estimate of ${usd(estimate)} would exceed it. The pipeline stops here — nothing was charged. ` +
      `Raising the cap is a config/limits.ts change, which is a ratification decision, not an override.`,
    )
  }
  const total = spentTotal(sqlite)
  if (total + estimate > CAPS.total) {
    throw new PipelineHalt(
      `BUDGET HALT (Part X): total external spend is ${usd(total)} of the ${usd(CAPS.total)} campaign cap; ` +
      `this call's estimate of ${usd(estimate)} would exceed it. The pipeline stops here — nothing was charged.`,
    )
  }
}

/** Every paid run writes spend (Part X). Amounts are actuals, from API usage. */
export function recordSpend(
  category: SpendCategory,
  amount: number,
  runRef: string,
  note: string,
  sqlite: BetterSqlite3.Database = getSqlite(),
): void {
  sqlite
    .prepare('INSERT INTO spend (at, category, amount, run_ref, note) VALUES (?, ?, ?, ?, ?)')
    .run(new Date().toISOString(), category, amount, runRef, note)
}
