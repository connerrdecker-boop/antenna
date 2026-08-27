/**
 * PART 8.4 — /metrics queries. Every number comes from the live DB; where the
 * data does not exist yet the value is null and the screen says so. Law of
 * data honesty: no fake numbers, no placeholder trends.
 */
import { getSqlite } from './connection'

export type SourceQualification = {
  source: string
  candidates: number
  decided: number
  everQualified: number
  /** everQualified / decided; null until anything from this source is decided. */
  rate: number | null
}

/**
 * Per-source qualification rate — the empirical test of the market-size
 * estimate. "Decided" = a ratify decision that moved status (approve/reject/
 * bank); "qualified" = ever reached `qualified` per status_history, so an
 * approve later undone counts the round-trip honestly (it is in the history).
 */
export function sourceQualification(): SourceQualification[] {
  const sqlite = getSqlite()
  return (sqlite
    .prepare(
      `SELECT c.source,
              COUNT(*) AS candidates,
              COUNT(DISTINCT CASE WHEN r.decision IN ('approve','reject','bank') THEN r.candidate_id END) AS decided,
              COUNT(DISTINCT CASE WHEN sh.to_status = 'qualified' THEN sh.candidate_id END) AS everQualified
       FROM candidates c
       LEFT JOIN ratifications r ON r.candidate_id = c.id
       LEFT JOIN status_history sh ON sh.candidate_id = c.id
       GROUP BY c.source ORDER BY candidates DESC`,
    )
    .all() as Array<Omit<SourceQualification, 'rate'>>)
    .map((row) => ({ ...row, rate: row.decided > 0 ? row.everQualified / row.decided : null }))
}

export type SpendSummary = {
  byCategory: { category: string; spent: number }[]
  total: number
  everQualified: number
  /** total spend / ever-qualified; null until someone qualifies. */
  costPerQualified: number | null
}

export function spendSummary(): SpendSummary {
  const sqlite = getSqlite()
  const byCategory = sqlite
    .prepare('SELECT category, COALESCE(SUM(amount),0) AS spent FROM spend GROUP BY category ORDER BY category')
    .all() as { category: string; spent: number }[]
  const total = byCategory.reduce((a, r) => a + r.spent, 0)
  const everQualified = (sqlite
    .prepare("SELECT COUNT(DISTINCT candidate_id) AS c FROM status_history WHERE to_status='qualified'")
    .get() as { c: number }).c
  return {
    byCategory,
    total,
    everQualified,
    costPerQualified: everQualified > 0 ? total / everQualified : null,
  }
}

export type DmDay = { day: string; sent: number }

/** Outbound DMs per day, last `days` days, from outreach_log (what was SENT). */
export function dmsPerDay(days = 14): DmDay[] {
  const sqlite = getSqlite()
  const rows = sqlite
    .prepare(
      `SELECT substr(at, 1, 10) AS day, COUNT(*) AS sent
       FROM outreach_log WHERE direction='out'
       GROUP BY day ORDER BY day DESC LIMIT ?`,
    )
    .all(days) as DmDay[]
  return rows.reverse()
}

export type ReplyStats = {
  everDmed: number
  everReplied: number
  /** everReplied / everDmed; null until anyone has been DMed. */
  rate: number | null
}

export function replyStats(): ReplyStats {
  const sqlite = getSqlite()
  const g = (status: string) =>
    (sqlite
      .prepare('SELECT COUNT(DISTINCT candidate_id) AS c FROM status_history WHERE to_status = ?')
      .get(status) as { c: number }).c
  const everDmed = g('dmed')
  const everReplied = g('replied')
  return { everDmed, everReplied, rate: everDmed > 0 ? everReplied / everDmed : null }
}

export type HarvestRunRow = {
  id: number
  adapter: string
  started_at: string
  status: string
  items_found: number | null
  items_new: number | null
  est_cost: number | null
  error: string | null
  provider: string | null
}

export function recentHarvestRuns(limit = 12): HarvestRunRow[] {
  const sqlite = getSqlite()
  return (sqlite
    .prepare(
      `SELECT id, adapter, started_at, status, items_found, items_new, est_cost, error, params
       FROM harvest_runs ORDER BY id DESC LIMIT ?`,
    )
    .all(limit) as Array<HarvestRunRow & { params: string | null }>)
    .map(({ params, ...row }) => {
      let provider: string | null = null
      try {
        provider = params ? ((JSON.parse(params) as { provider?: string }).provider ?? null) : null
      } catch { /* legacy rows */ }
      return { ...row, provider }
    })
}
