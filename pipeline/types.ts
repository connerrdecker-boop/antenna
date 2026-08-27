/**
 * Pipeline types. The spine (Part 2.1):
 *   HARVEST -> PRE-SCORE (cheap model, bio-only) -> [threshold gate] ->
 *   ENRICH (profile + link page, + observation) -> FULL SCORE -> RATIFY.
 */

/** What an enrichment provider returns for one handle. */
export type ProfilePacket = {
  handle: string
  name?: string | null
  bio: string
  followerCount: number
  /** ~last 6 posts' captions (Part V). */
  captions?: string[]
  /** Post count over the trailing 30 days. */
  posts30d?: number | null
  /** e.g. { reel: 0.6, carousel: 0.25, image: 0.15 } */
  formatMix?: Record<string, number> | null
  engagementProxy?: number | null
  /** Location/venue tags observed on recent posts. */
  tags?: string[]
  linkUrl?: string | null
  /** Text of the link page, when the provider already has it. */
  linkContents?: string | null
}

/**
 * An enrichment source. Two implementations in A2:
 *   - fixture/manual: local JSON packets — committed fixtures for tests, plus
 *     gitignored ./profiles/*.json where the operator drops real packets.
 *   - actor: the Apify-class profile scraper. STUB until A3 wires it.
 */
export interface ProfileProvider {
  readonly name: string
  fetchProfile(handle: string): Promise<ProfilePacket | null>
}

/** Stage 1 output (prompts/prescore_v1.md). */
export type PrescoreResult = {
  pre_score: number
  kill_reasons: string[]
}

/** Stage 2 output (prompts/score_v1.md) — shape is canon, Part 6.2. */
export type ScoreResult = {
  gates: Record<'sells_online_coaching' | 'is_individual_coach' | 'alive_30d', { pass: boolean; evidence: string }>
  dims: {
    dm_run: { pts: number; evidence: string }
    size_band: { pts: number; evidence: string }
    metro: { metro: 'nyc' | 'sofla' | 'other' | 'unknown'; confidence: number; pts: number; evidence: string }
    online_purity: { pts: number; evidence: string }
    activity: { pts: number; evidence: string }
    engagement_proxy: { pts: number; evidence: string }
  }
  penalties: { incumbent_tooling: { pts: number; evidence: string } }
  stack_signals: string[]
  extracted: { name: string; offers: { type: string; price: string | null }[]; lead_magnet: string | null }
  hook_draft: string
  score: number
  tier: 'A' | 'B' | 'C' | 'X'
}
