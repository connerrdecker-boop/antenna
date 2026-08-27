/**
 * ══════════════════════════ RATIFIED v1 (A3) ══════════════════════════
 * The Part 4a seller-exhaust query library, STARTER SET, transcribed from the
 * blueprint verbatim. Part XV.8's red pen has passed: this set stands as-is
 * for the first harvest. Tuning comes from A4's measured-run data, not from
 * armchair edits — a query that earns its keep is one the numbers vouch for.
 *
 * `npm run check` asserts this file matches the Part 4a starter set exactly,
 * so a future edit is a canon-and-config change together, never a silent one.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * `{metro_term}` is expanded combinatorially over config/metros.ts terms at
 * run time; every generated query is logged in harvest_runs.params (Law 4).
 */

export const QUERY_LIBRARY_STATUS = 'ratified v1 (A3) — tune from A4 measured data'

/** The eight canon templates (Part 4a), verbatim. */
export const QUERY_TEMPLATES: readonly string[] = [
  'site:stan.store ("online coach" OR "coaching") {metro_term}',
  'site:stan.store (fitness OR "personal trainer") {metro_term}',
  'site:linktr.ee "online fitness coach" {metro_term}',
  'site:linktr.ee ("apply" OR "coaching application") fitness {metro_term}',
  'site:beacons.ai fitness coach {metro_term}',
  'site:instagram.com "online coach" "{metro_term}" ("comment" OR "DM me")',
  'site:instagram.com fitness coach "{metro_term}" ("spots open" OR "apply")',
  '"1:1 coaching" fitness "{metro_term}" ("stan.store" OR "linktr.ee")',
]

/** Part 4a: pagination to ~5 pages/query max. */
export const MAX_PAGES_PER_QUERY = 5

/** Expand templates over a metro's terms. */
export function buildQueries(terms: readonly string[]): string[] {
  return QUERY_TEMPLATES.flatMap((t) => terms.map((term) => t.replaceAll('{metro_term}', term)))
}
