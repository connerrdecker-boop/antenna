/**
 * PART III — DATA CANON (the schema). This file is canon: the blueprint's
 * field lists are implemented exactly, in blueprint order.
 *
 * Enforcement that SQLite can guarantee (handle lowercase + unique, signed
 * requires loi_tier, status_history on every status change, observations
 * append-only, enum membership) lives in db/enforcement.sql as triggers, so it
 * holds for ANY writer — Drizzle, a script, or a raw sqlite3 shell.
 */
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import {
  DIRECTIONS, LINK_FETCH_STATUSES, LOI_TIERS, METROS, RUN_STATUSES,
  SPEND_CATEGORIES, STATUSES, TIERS,
} from './enums'

/**
 * candidates — `handle` is THE dedupe key: unique, lowercased.
 * json columns hold JSON text; use the parse helpers in db/json.ts.
 */
export const candidates = sqliteTable('candidates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  handle: text('handle').notNull(),
  igUrl: text('ig_url'),
  name: text('name'),
  followerCount: integer('follower_count'),
  bio: text('bio'),
  linkUrl: text('link_url'),
  linkDomain: text('link_domain'),
  linkContents: text('link_contents'),
  linkFetchStatus: text('link_fetch_status', { enum: LINK_FETCH_STATUSES }),
  metro: text('metro', { enum: METROS }),
  /** 0-1 */
  metroConfidence: real('metro_confidence'),
  source: text('source').notNull(),
  sourceDetail: text('source_detail'),
  firstSeen: text('first_seen').notNull(),
  lastEnriched: text('last_enriched'),
  preScore: integer('pre_score'),
  score: integer('score'),
  tier: text('tier', { enum: TIERS }),
  scorePromptVersion: text('score_prompt_version'),
  /** json string[] */
  evidence: text('evidence'),
  hookDraft: text('hook_draft'),
  /** json string[] — e.g. ["stan_store","venmo_mention","klarna"] */
  stackSignals: text('stack_signals'),
  /** json: { name, offers[{type,price?}], lead_magnet? } */
  extracted: text('extracted'),
  status: text('status', { enum: STATUSES }).notNull().default('sourced'),
  followupCount: integer('followup_count').notNull().default(0),
  loiTier: text('loi_tier', { enum: LOI_TIERS }),
  notes: text('notes'),
  nextActionDate: text('next_action_date'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => [
  uniqueIndex('candidates_handle_unique').on(t.handle),
  index('candidates_status_idx').on(t.status),
  index('candidates_tier_idx').on(t.tier),
  index('candidates_metro_idx').on(t.metro),
  index('candidates_source_idx').on(t.source),
  // Secondary dedupe (Part III): candidates sharing a link page are FLAGGED for
  // manual merge, never auto-merged. This index makes that scan cheap.
  index('candidates_link_url_idx').on(t.linkUrl),
])

/** status_history — written on EVERY transition, no exceptions (trigger-enforced). */
export const statusHistory = sqliteTable('status_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  candidateId: integer('candidate_id').notNull()
    .references(() => candidates.id, { onDelete: 'cascade' }),
  /** null only on the genesis row written when a candidate is created. */
  fromStatus: text('from_status', { enum: STATUSES }),
  toStatus: text('to_status', { enum: STATUSES }).notNull(),
  at: text('at').notNull(),
  note: text('note'),
}, (t) => [
  index('status_history_candidate_idx').on(t.candidateId),
  index('status_history_to_status_idx').on(t.toStatus),
])

/**
 * ratifications — THIS TABLE IS THE TRAINING DATA. The few-shot loop (Part 6.5)
 * reads it. Every ratify keystroke writes a row.
 */
export const ratifications = sqliteTable('ratifications', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  candidateId: integer('candidate_id').notNull()
    .references(() => candidates.id, { onDelete: 'cascade' }),
  decision: text('decision', { enum: ['approve', 'reject', 'bank', 'flag'] }).notNull(),
  reason: text('reason'),
  at: text('at').notNull(),
}, (t) => [
  index('ratifications_candidate_idx').on(t.candidateId),
  index('ratifications_at_idx').on(t.at),
])

/** harvest_runs — provenance + per-source qualification metrics + cost ledger feed. */
export const harvestRuns = sqliteTable('harvest_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  adapter: text('adapter').notNull(),
  /** json */
  params: text('params'),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
  itemsFound: integer('items_found'),
  itemsNew: integer('items_new'),
  estCost: real('est_cost'),
  status: text('status', { enum: RUN_STATUSES }).notNull().default('running'),
  error: text('error'),
}, (t) => [index('harvest_runs_adapter_idx').on(t.adapter)])

/** outreach_log — what was actually sent/received. Feeds reply-rate-by-opener learning. */
export const outreachLog = sqliteTable('outreach_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  candidateId: integer('candidate_id').notNull()
    .references(() => candidates.id, { onDelete: 'cascade' }),
  direction: text('direction', { enum: DIRECTIONS }).notNull(),
  text: text('text'),
  at: text('at').notNull(),
}, (t) => [
  index('outreach_log_candidate_idx').on(t.candidateId),
  index('outreach_log_at_idx').on(t.at),
])

/**
 * observations — THE OBSERVATORY (Part IX). APPEND-ONLY (Law 9).
 * Keyed by `handle`, not candidate_id: the panel outlives any candidate row.
 * UPDATE and DELETE are blocked by trigger; db/observations.ts exposes insert only.
 */
export const observations = sqliteTable('observations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  handle: text('handle').notNull(),
  observedAt: text('observed_at').notNull(),
  followerCount: integer('follower_count'),
  posts30d: integer('posts_30d'),
  /** json */
  formatMix: text('format_mix'),
  engagementProxy: real('engagement_proxy'),
  source: text('source').notNull(),
}, (t) => [
  index('observations_handle_idx').on(t.handle),
  index('observations_observed_at_idx').on(t.observedAt),
])

/** spend — SUM(amount) is checked against the cap before every paid operation. */
export const spend = sqliteTable('spend', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  at: text('at').notNull(),
  category: text('category', { enum: SPEND_CATEGORIES }).notNull(),
  amount: real('amount').notNull(),
  runRef: text('run_ref'),
  note: text('note'),
}, (t) => [index('spend_category_idx').on(t.category)])

export type Candidate = typeof candidates.$inferSelect
export type NewCandidate = typeof candidates.$inferInsert
export type StatusHistoryRow = typeof statusHistory.$inferSelect
export type RatificationRow = typeof ratifications.$inferSelect
export type OutreachLogRow = typeof outreachLog.$inferSelect
export type ObservationRow = typeof observations.$inferSelect
export type SpendRow = typeof spend.$inferSelect
export type HarvestRunRow = typeof harvestRuns.$inferSelect
