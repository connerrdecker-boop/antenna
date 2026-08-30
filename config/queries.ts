/**
 * ══════════════════════ RATIFIED v2 (A2-national) ══════════════════════
 * The Part 4a seller-exhaust query library, transcribed from the blueprint
 * verbatim. `npm run check` asserts this file matches Part 4a exactly, so an
 * edit is a canon-and-config change together, never a silent one.
 *
 * WHY v1 WAS REPLACED, from the calibration data rather than from taste:
 *
 *   Every one of the eight v1 templates was metro-anchored and expanded over
 *   19 metro terms — 152 queries, all of them constraining discovery to two
 *   metros. The national decision makes that backwards.
 *
 *   Five of the eight led with a link DOMAIN (stan.store, linktr.ee,
 *   beacons.ai). The batch says domain is not a filter: linktr.ee ran 3 keep
 *   / 6 reject, and the one stan.store profile was REJECTED. The keepers
 *   scattered across linktw.in, youtu.be, a Typeform and two custom domains.
 *   Five slots were being spent on a signal worse than chance.
 *
 * WHAT REPLACED IT. All five approvals share one construction nearly verbatim
 * — `[DM|Message] me "<KEYWORD>" for [1:1 | 1-on-1 | 1 on 1] coaching` — and
 * three of five open `I help <audience> <outcome>`. That is the dm_run
 * dimension, the +7.5 discriminator between approvals and banks, sitting in
 * the bio as literal searchable text. So the library searches for it directly
 * instead of for the platforms it might be hosted on.
 * ═══════════════════════════════════════════════════════════════════════
 */

export const QUERY_LIBRARY_STATUS =
  'ratified v2 (A2-national) — built from the calibration approvals; tune from wave-one measured yield'

/** Tier 1 axes: the approval signature, verbatim from the approved bios. */
export const SIGNATURE_VERBS: readonly string[] = ['DM', 'Message', 'Msg']
export const SIGNATURE_OFFERS: readonly string[] = ['1:1 coaching', '1 on 1 coaching', '1-on-1 coaching']

/**
 * Tier 2 axis. The calibration batch was 32 of 32 male-coded, so `women` and
 * `beginners` correct a sampling bias deliberately — they are not a yield play
 * and should not be dropped if wave one shows them thinner.
 */
export const AUDIENCES: readonly string[] = ['men', 'women', 'busy professionals', 'beginners']

/** Tier 3: funnel and selling signals, no metro. */
export const FUNNEL_TEMPLATES: readonly string[] = [
  'site:instagram.com "coaching application" ("apply" OR "DM")',
  'site:instagram.com "online coach" "spots open"',
  'site:instagram.com "comment" "for the free" coaching fitness',
  'site:instagram.com ("online coaching" OR "remote coaching") "clients"',
  // The ONLY surviving domain query, demoted from five slots to one and kept
  // purely as bonus discovery: a Stan Store hit is still double gold when it
  // lands, it just is not worth five of eight slots.
  '("1:1 coaching" OR "1 on 1 coaching") fitness ("stan.store" OR "linktr.ee" OR "beacons.ai")',
]

/** Tier 4: metro is worth 5 bonus points now, so it earns 8 slots, not 152. */
export const METRO_ANCHORS: readonly string[] = ['NYC', 'New York', 'Miami', 'South Florida']
export const METRO_TEMPLATES: readonly string[] = [
  'site:instagram.com "DM me" "1:1 coaching" {metro_anchor}',
  'site:instagram.com "online coach" {metro_anchor} "apply"',
]

/** Part 4a: pagination to ~5 pages/query max. */
export const MAX_PAGES_PER_QUERY = 5

/**
 * The full ratified library, 26 queries. Takes no metro argument: the cohort
 * is national, and the only metro-shaped queries are the Tier 4 bonus pair,
 * which expand over their own fixed anchors rather than over the caller's
 * metro. A caller that wants fewer queries slices the result (AdapterParams
 * .maxQueries) rather than narrowing the library.
 */
export function buildQueries(): string[] {
  const tier1 = SIGNATURE_VERBS.flatMap((verb) =>
    SIGNATURE_OFFERS.map((offer) => `site:instagram.com "${verb} me" "for ${offer}"`),
  )
  const tier2 = AUDIENCES.map(
    (a) => `site:instagram.com "I help ${a}" ("DM" OR "message") coaching`,
  )
  const tier3 = [...FUNNEL_TEMPLATES]
  const tier4 = METRO_TEMPLATES.flatMap((t) =>
    METRO_ANCHORS.map((anchor) => t.replaceAll('{metro_anchor}', anchor)),
  )
  return [...tier1, ...tier2, ...tier3, ...tier4]
}
