/**
 * ═══════════════ RATIFIED v1 (A3) — EMPTY IS THE CORRECT STATE ═══════════════
 * Part 4c seed-account list for commenter/tagged harvesting: 10–20 local
 * coaches per metro, sourced from 4a/4b's best finds + Christopher's orbit,
 * post-confirmation. The canon's own instruction: "leave list empty; I fill
 * it."
 *
 * Empty here is a RATIFIED state, not an unfinished one — and it carries a
 * PERMANENT GATE, not a temporary one: seed-based harvest halts while a
 * metro's list is empty, and keeps halting every time it is emptied again.
 * Only Conner adds handles; the builder never does, because a guessed seed
 * list would poison the graph-proxy sample it exists to make trustworthy.
 * ════════════════════════════════════════════════════════════════════════════
 */

export const SEED_LIST_STATUS = 'ratified v1 (A3) — empty by design, operator-filled'

/** Bare lowercase handles, no @. Filled by the operator, never by the builder. */
export const SEED_ACCOUNTS: Record<'nyc' | 'sofla', readonly string[]> = {
  nyc: [],
  sofla: [],
}

/** The permanent gate (ratified A3). Seed-based harvest never runs on an empty list. */
export function seedGateMessage(metro: 'nyc' | 'sofla'): string {
  return (
    `seed list empty — Conner fills this. The ${metro} seed-account list (config/seeds.ts) has no ` +
    'handles, which is its ratified default state (Part 4c: "leave list empty; I fill it"). ' +
    'Add 10-20 local coaches from the best 4a/4b finds + Christopher\'s orbit, then re-run. ' +
    'Nothing was charged.'
  )
}
