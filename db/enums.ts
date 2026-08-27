/**
 * PART III — DATA CANON: enums first, exact strings, everywhere.
 * These string literals are blueprint canon. Never rename, never alias.
 */

export const STATUSES = [
  'sourced', 'qualified', 'dmed', 'replied', 'no_response', 'call_booked',
  'demo_given', 'loi_sent', 'signed', 'declined', 'rejected', 'banked',
] as const
export type Status = (typeof STATUSES)[number]

export const TIERS = ['A', 'B', 'C', 'X'] as const
export type Tier = (typeof TIERS)[number]

export const LOI_TIERS = ['t1', 't2', 't3'] as const
export type LoiTier = (typeof LOI_TIERS)[number]

export const METROS = ['nyc', 'sofla', 'other', 'unknown'] as const
export type Metro = (typeof METROS)[number]

/** Ratify-queue decisions (Part VII). */
export const DECISIONS = ['approve', 'reject', 'bank', 'flag'] as const
export type Decision = (typeof DECISIONS)[number]

export const LINK_FETCH_STATUSES = ['ok', 'failed', 'skipped'] as const
export type LinkFetchStatus = (typeof LINK_FETCH_STATUSES)[number]

/** outreach_log.direction (Part III). */
export const DIRECTIONS = ['out', 'in'] as const
export type Direction = (typeof DIRECTIONS)[number]

/** spend.category (Part III) — mirrors the per-category caps in config/limits.ts. */
export const SPEND_CATEGORIES = ['serp', 'actors', 'llm'] as const
export type SpendCategory = (typeof SPEND_CATEGORIES)[number]

/**
 * harvest_runs.status. INVENTION: Part III names the column but does not
 * enumerate it; these are the three states a run can be in.
 */
export const RUN_STATUSES = ['running', 'ok', 'failed'] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

/** Reject reasons offered by the ratify queue's picker (Part VII). */
export const REJECT_REASONS = [
  'not-a-coach', 'gym-floor', 'not-selling', 'too-big', 'too-small', 'dead', 'other',
] as const
export type RejectReason = (typeof REJECT_REASONS)[number]

/** LOI strength tiers (Part 8.2 / Glossary). */
export const LOI_TIER_LABELS: Record<LoiTier, string> = {
  t1: 'T1 — signature only',
  t2: 'T2 — + stated beta commitment',
  t3: 'T3 — + deposit',
}
