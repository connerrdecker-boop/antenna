/**
 * ════════════════════ DRAFT — pending ratification ════════════════════
 * Part 4c seed-account list for commenter/tagged harvesting: 10–20 local
 * coaches per metro, sourced from 4a/4b's best finds + Christopher's orbit,
 * post-confirmation. The canon's own instruction: "leave list empty; I fill
 * it." Empty until the operator does. The commenters adapter no-ops with a
 * clear message while any metro's list is empty.
 * ═══════════════════════════════════════════════════════════════════════
 */

export const SEED_LIST_STATUS = 'DRAFT — pending ratification'

/** Bare lowercase handles, no @. Filled by the operator, never by the builder. */
export const SEED_ACCOUNTS: Record<'nyc' | 'sofla', readonly string[]> = {
  nyc: [],
  sofla: [],
}
