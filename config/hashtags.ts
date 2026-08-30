/**
 * ══════════════════════════ RATIFIED v1 (A3) ══════════════════════════
 * The Part 4b starter hashtag library, transcribed from the blueprint
 * verbatim. Part XV.8's red pen has passed: this set stands as-is for the
 * first harvest.
 *
 * Expansion policy (canon): expand from observed bios; log expansions —
 * additions land here with a dated comment, never inline in code.
 * ═══════════════════════════════════════════════════════════════════════
 */

export const HASHTAG_LIBRARY_STATUS =
  'ratified v2 (A2-national) — national core expanded from the calibration bios; metro tags demoted to opt-in'

/**
 * The NATIONAL core (Part 4b). Grown from four to eleven at the national
 * ratification: the canon rule has always been "expand from observed bios",
 * and the calibration bios are now observed. The seven additions come from the
 * approvals' own language — 1:1 framing, the fat-loss/transformation outcome
 * vocabulary, and the audience split that the 32/32 male-coded batch made
 * conspicuous by its absence.
 */
export const CORE_HASHTAGS: readonly string[] = [
  '#onlinefitnesscoach', '#onlinecoach', '#fitnesscoach', '#nutritioncoach',
  '#onlinecoaching', '#1on1coaching', '#onlinepersonaltrainer',
  '#fatlosscoach', '#transformationcoach', '#mensfitnesscoach', '#womensfitnesscoach',
]

/**
 * Per-metro tags, now OPT-IN rather than always appended. Metro is a 5-point
 * bonus under score_v3, not a gate, so a national run should not spend actor
 * budget on metro tags by default — `hashtagsFor(metro)` is the door that
 * asks for them.
 */
export const METRO_HASHTAGS: Record<'nyc' | 'sofla', readonly string[]> = {
  nyc: [
    '#nycfitnesscoach', '#nycpersonaltrainer', '#nycfitness',
    '#brooklynfitness', '#manhattanfitness',
  ],
  sofla: [
    '#miamifitnesscoach', '#miamipersonaltrainer', '#miamifitness',
    '#fortlauderdalefitness', '#bocaratonfitness', '#westpalmbeachfitness',
    '#southfloridafitness',
  ],
}

/** The national run: core tags only. */
export function nationalHashtags(): string[] {
  return [...CORE_HASHTAGS]
}

/** Core + one metro's bonus tags, for a deliberate metro sweep. */
export function hashtagsFor(metro: 'nyc' | 'sofla'): string[] {
  return [...CORE_HASHTAGS, ...METRO_HASHTAGS[metro]]
}

/**
 * Location-tag venue feeds (Part 4b). EMPTY BY DESIGN, ratified A3: the canon
 * builds this list from what harvested bios actually tag — data over
 * guessing. Populating it before the first harvest would be exactly the
 * armchair guess the canon rules out. Filled after A4's measured run.
 */
export const VENUE_TAGS: Record<'nyc' | 'sofla', readonly string[]> = { nyc: [], sofla: [] }
