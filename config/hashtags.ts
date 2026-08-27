/**
 * ════════════════════ DRAFT — pending ratification ════════════════════
 * The Part 4b starter hashtag library, transcribed from the blueprint
 * verbatim. Part XV.8: red-pen before A3 runs them. Until then `npm run
 * check` asserts this DRAFT marker exists and the REAL actor provider
 * refuses to run; the fixture provider runs freely.
 *
 * Expansion policy (canon): expand from observed bios; log expansions —
 * additions land here with a dated comment, never inline in code.
 * ═══════════════════════════════════════════════════════════════════════
 */

export const HASHTAG_LIBRARY_STATUS = 'DRAFT — pending ratification'

/** Metro-agnostic core tags (Part 4b). */
export const CORE_HASHTAGS: readonly string[] = [
  '#onlinefitnesscoach', '#onlinecoach', '#fitnesscoach', '#nutritioncoach',
]

/** Per-metro tags (Part 4b), keyed by the Part III metro enum. */
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

export function hashtagsFor(metro: 'nyc' | 'sofla'): string[] {
  return [...CORE_HASHTAGS, ...METRO_HASHTAGS[metro]]
}

/**
 * Location-tag venue feeds (Part 4b): built during A3 from what harvested
 * bios actually tag — data over guessing. Empty until the data exists.
 */
export const VENUE_TAGS: Record<'nyc' | 'sofla', readonly string[]> = { nyc: [], sofla: [] }
