/**
 * THE OBSERVATORY (Part IX) — APPEND-ONLY (Law 9).
 *
 * This module deliberately exposes INSERT and SELECT and nothing else: there is
 * no update path here, and none exists in the database either (the
 * observations_no_update / observations_no_delete triggers abort any attempt).
 * Snapshots accumulate; nothing overwrites history.
 */
import { desc, eq } from 'drizzle-orm'
import { getDb } from './connection'
import { toJson } from './json'
import { observations } from './schema'

export type ObservationInput = {
  handle: string
  followerCount?: number | null
  posts30d?: number | null
  formatMix?: Record<string, number> | null
  engagementProxy?: number | null
  source: string
  observedAt?: string
}

/** The only writer. Every harvest and enrichment calls this (Part V, Part IX). */
export function recordObservation(input: ObservationInput): void {
  getDb().insert(observations).values({
    handle: input.handle.toLowerCase(),
    observedAt: input.observedAt ?? new Date().toISOString(),
    followerCount: input.followerCount ?? null,
    posts30d: input.posts30d ?? null,
    formatMix: toJson(input.formatMix ?? null),
    engagementProxy: input.engagementProxy ?? null,
    source: input.source,
  }).run()
}

export function observationsFor(handle: string) {
  return getDb().select().from(observations)
    .where(eq(observations.handle, handle.toLowerCase()))
    .orderBy(desc(observations.observedAt)).all()
}
