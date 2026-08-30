/**
 * ═══════════════ RATIFIED — apify~instagram-profile-scraper ═══════════════
 * Part 4b actor selection. The canon is explicit that this is a day-of
 * decision: "Actor names churn: the builder selects currently-maintained
 * 'Instagram hashtag scraper' / 'Instagram profile scraper'–class actors and
 * smoke-tests each with a ≤$2 run before any scale run."
 *
 * THE SMOKE TEST THAT RATIFIED IT (npm run smoke:actor, 2026-08-29):
 *   run       H9wnMKKDF50CPcKWn · SUCCEEDED in ~17s
 *   handles   @heath.lifts, @tommy_lifts10, @jakeclayfit — real, un-enriched,
 *             chosen to cover handle-format variation (dot · underscore+digit
 *             · plain), since username formatting is where actor inputs break
 *   charged   $0.0052 against the $2 ceiling, Apify's own figure
 *   packets   3 of 3 complete — bio, followers, link, 12 captions, posts30d,
 *             formatMix and engagement present on every one
 *   mapping   username→handle · fullName→name · biography→bio ·
 *             followersCount · private · externalUrl · latestPosts
 *   the one NOT FOUND was real: @jakeclayfit carries `externalUrls: []` and
 *   no externalUrl key at all — that account has no link in bio. The mapper
 *   was right and the field was genuinely absent, which is the distinction
 *   the raw dump exists to settle.
 *
 * The operator saw those packets and said go. That is what ratification IS
 * here — a human looking at real output, never an id typed into a config.
 *
 * The marker stays load-bearing in the other direction now, exactly as the A3
 * config markers did: a selection that silently regresses to DRAFT turns
 * `npm run check` red, because un-ratifying an actor is a canon decision
 * rather than a code change. Scale runs are open; ACTOR_SMOKE_TEST_CAP still
 * bounds the smoke door, and lib/budget.ts still gates every paid call.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const ACTOR_SELECTION_STATUS =
  'ratified v1 (2026-08-29) — apify~instagram-profile-scraper, smoke run H9wnMKKDF50CPcKWn, $0.0052, 3/3 packets complete, operator approved'

/** True while no actor has passed its smoke test. Gates every scale run. */
export function actorSelectionIsDraft(): boolean {
  return ACTOR_SELECTION_STATUS.startsWith('DRAFT')
}

/**
 * Profile-scraper-class candidates, most-likely first. Apify ids use `~`
 * between owner and actor name in API paths (`apify~instagram-profile-scraper`).
 * Each entry records the input shape we would send, because that is the part
 * that churns hardest between actor generations.
 */
export type ActorCandidate = {
  /** API-path id (owner~name). */
  id: string
  /** What it is, for the operator reading the smoke-test output. */
  note: string
  /** Build the actor input for a batch of bare handles. */
  buildInput: (handles: readonly string[]) => Record<string, unknown>
}

export const PROFILE_ACTOR_CANDIDATES: readonly ActorCandidate[] = [
  {
    id: 'apify~instagram-profile-scraper',
    // RATIFIED — the smoke test above observed this exact input and output
    // shape. `usernames` takes bare handles (no @, no URL) and the actor
    // returns one item per handle carrying profile fields plus latestPosts.
    note: 'Apify-official profile scraper. Takes bare usernames; returns profile + latestPosts. RATIFIED 2026-08-29.',
    buildInput: (handles) => ({ usernames: [...handles] }),
  },
  {
    id: 'apify~instagram-scraper',
    note: 'Apify-official general IG scraper in details mode. Fallback if the profile actor is retired.',
    buildInput: (handles) => ({
      directUrls: handles.map((h) => `https://www.instagram.com/${h}/`),
      resultsType: 'details',
      resultsLimit: 12,
    }),
  },
]

/** The candidate the smoke test runs unless told otherwise. */
export const DEFAULT_PROFILE_ACTOR = PROFILE_ACTOR_CANDIDATES[0]

/**
 * Run bounds for any actor call. `maxTotalChargeUsd` is the real hard cap on
 * pay-per-event actors; the others bound a runaway compute-unit run. These are
 * belt AND braces with lib/budget.ts: budget.ts stops us spending money we
 * have already spent elsewhere, these stop THIS run being the expensive one.
 */
export const ACTOR_RUN_BOUNDS = {
  /** Seconds. A profile batch that has not finished by now is stuck. */
  timeoutSecs: 300,
  /** MB. The smallest tier these actors run in. */
  memoryMbytes: 1024,
  /** Poll interval while waiting for a run to reach a terminal state. */
  pollMs: 3000,
} as const

/** Law 3: no cookies, no session, ever — asserted on the way out, not assumed. */
export const FORBIDDEN_INPUT_KEYS = [
  'cookies', 'cookie', 'sessionid', 'sessionId', 'session', 'loginCookies',
  'username_password', 'password', 'authorization', 'auth', 'proxyPassword',
] as const
