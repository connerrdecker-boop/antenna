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

export const HASHTAG_LIBRARY_STATUS = 'ratified v1 (A3) — expand from observed bios'

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
 * Location-tag venue feeds (Part 4b). EMPTY BY DESIGN, ratified A3: the canon
 * builds this list from what harvested bios actually tag — data over
 * guessing. Populating it before the first harvest would be exactly the
 * armchair guess the canon rules out. Filled after A4's measured run.
 */
export const VENUE_TAGS: Record<'nyc' | 'sofla', readonly string[]> = { nyc: [], sofla: [] }
