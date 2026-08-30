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

/**
 * Harvest cost rates, USD — mid-points of the Part 2.5b ranges (Serper
 * ~$1/1K searches; actors ~$1–3/1K profiles). Used for the pre-run estimate
 * shown BEFORE confirm (/settings) and the pre-call budget gate; ACTUAL spend
 * is written from provider receipts once the real providers are wired.
 */
export const HARVEST_COST = {
  serpPerQuery: 0.001,
  actorPerItem: 0.002,
} as const

/**
 * Part 4b canon: the real actor must be SMOKE-TESTED with a <= $2 run, and the
 * operator shown results, before any scale run.
 */
export const ACTOR_SMOKE_TEST_CAP = 2

/** Tier cuts (Part 6.2 RULES). Unchanged at the national ratification: the
 *  CEILING was broken under v1, not the cuts. A national profile could reach
 *  at most 70 against an A-cut of 75; under score_v3 it can reach 95. */
export const TIER_CUTS = { A: 75, B: 55, C: 40 } as const

/**
 * THE SIZE BAND (ratified 2026-08-30, the NATIONAL founding-cohort decision).
 *
 * Rebuilt from the operator's own calibration verdicts rather than from the
 * original 1K–10K guess. The evidence: all four approvals sat between 22,077
 * and 71,610 followers and every one of them scored the v1 quarter-point
 * floor, while @santinoanzevino at 3,619 — squarely inside the old ideal band —
 * was BANKED for being on hiatus. Size, as v1 measured it, was anti-correlated
 * with the operator's taste.
 *
 * `max` is inclusive. Two breakpoints carry specific verdicts:
 *
 *   80,001–150,000 at 8 — @koda.kammer (115,461) was banked "right coach,
 *     wrong wave (size)". At 12 points they project to 77 and land tier A,
 *     which would contradict that verdict outright; at 8 they land 73 (B).
 *
 *   >600,000 at 1 — @hunterstein_wk (718,043), banked "too big to cold DM",
 *     is otherwise a maxed profile (dm_run 25/25, purity 15/15, activity
 *     10/10). Only a genuinely punitive top band keeps them out of A.
 */
export const SIZE_BANDS: readonly { max: number; pts: number; label: string }[] = [
  { max: 499, pts: 0, label: 'below a business' },
  { max: 2_999, pts: 12, label: 'emerging' },
  { max: 80_000, pts: 20, label: 'the founding-cohort band' },
  { max: 150_000, pts: 8, label: 'above the band — wrong wave' },
  { max: 300_000, pts: 6, label: 'well above the band' },
  { max: 600_000, pts: 3, label: 'large account' },
  { max: Number.POSITIVE_INFINITY, pts: 1, label: 'too big to cold DM' },
] as const

/**
 * Points for an UNKNOWN follower count — the neutral midpoint, never 0.
 *
 * @cruzbrahh has a null follower count and the operator approved them. Part V
 * already holds that "a missing follower count is UNKNOWN, and coercing it to
 * 0 would feed size_band a confident falsehood"; scoring absent data as if it
 * were a disqualifying fact is the same error one layer up.
 */
export const SIZE_BAND_UNKNOWN_PTS = 10

/** The ratified curve, as a function. Deterministic — never asked of a model. */
export function sizeBandPoints(followerCount: number | null | undefined): number {
  if (followerCount === null || followerCount === undefined || !Number.isFinite(followerCount)) {
    return SIZE_BAND_UNKNOWN_PTS
  }
  return SIZE_BANDS.find((b) => followerCount <= b.max)!.pts
}

/** The band's human label, for the evidence panel. */
export function sizeBandLabel(followerCount: number | null | undefined): string {
  if (followerCount === null || followerCount === undefined || !Number.isFinite(followerCount)) {
    return 'follower count unknown — neutral credit, not a penalty'
  }
  const band = SIZE_BANDS.find((b) => followerCount <= b.max)!
  return `${followerCount.toLocaleString()} followers — ${band.label}`
}

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
