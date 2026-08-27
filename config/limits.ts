/**
 * Antenna limits — Part X (budget), Part XV.4 (thresholds).
 * Every number here is blueprint canon. Change only by ratification.
 */

/** Budget caps in USD. Law 6: budget caps live in code. */
export const CAPS = {
  /** Hard cap on all external spend for the campaign. */
  total: 250,
  /** Per-category caps (Part X). */
  serp: 25,
  actors: 100,
  llm: 75,
} as const

/** Enrich runs only on candidates at or above this pre-score (Part V). */
export const PRESCORE_THRESHOLD = 40

/** Tier cuts (Part 6.2 RULES). */
export const TIER_CUTS = { A: 75, B: 55, C: 40 } as const

/** DM pacing guard (Part 8.3). Soft warning, then hard warning. */
export const PACING = { soft: 25, hard: 40 } as const

/**
 * Follow-up policy (Part 8.2, canon): exactly ONE follow-up per candidate,
 * 5-7 days after the DM, then no_response. Never a third touch.
 */
export const FOLLOWUP = {
  maxPerCandidate: 1,
  dueAfterDaysMin: 5,
  dueAfterDaysMax: 7,
  /** Quiet days after the single follow-up before a candidate goes no_response. */
  quietDaysAfterFollowup: 7,
} as const
