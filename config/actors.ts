/**
 * ═══════════ DRAFT — SELECTION UNVERIFIED UNTIL THE SMOKE TEST PASSES ═══════════
 * Part 4b actor selection. The canon is explicit that this is a day-of
 * decision: "Actor names churn: the builder selects currently-maintained
 * 'Instagram hashtag scraper' / 'Instagram profile scraper'–class actors and
 * smoke-tests each with a ≤$2 run before any scale run."
 *
 * So this file names a CANDIDATE, not a choice. The id below is the
 * best-known maintained profile-scraper-class actor, but it has NOT been
 * confirmed against the live Apify store from this machine, and its output
 * schema has NOT been observed. Both happen in `npm run smoke:actor`, whose
 * whole job is to turn this draft into a ratified selection or reject it.
 *
 * The DRAFT marker is load-bearing, exactly as the A3 config markers were:
 * every real-actor code path refuses to run a SCALE job while it is set. The
 * smoke test is the one path allowed through, capped at ACTOR_SMOKE_TEST_CAP.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const ACTOR_SELECTION_STATUS =
  'DRAFT (A2-calibration) — candidate ids listed, none smoke-tested; scale runs refuse until ratified'

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
    note: 'Apify-official profile scraper. Takes bare usernames; returns profile + latestPosts.',
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
