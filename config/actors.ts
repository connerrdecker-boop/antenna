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
 * WHAT THE RATIFIED SELECTION HAS DONE SINCE (both runs on this actor):
 *   QI1TA8oJBccV0BHp3  the A2 scale enrich · 32 handles · SUCCEEDED · $0.0806
 *                      one batched run, not 32 — prefetch() through the batch
 *                      door. Produced the 31 observations the calibration
 *                      scored against.
 *   calibrate:refetch  32 handles · SUCCEEDED · $0.0312 · 32/32 packets, 357
 *                      captions. A rebuilt container had lost ./profiles
 *                      (gitignored, Law 5) and the snapshot cannot carry
 *                      captions, so the scorer's stated INPUT was arriving
 *                      empty and alive_30d — a GATE — had nothing to read.
 *   Total on this selection: $0.1170 of the $100 actors cap. Zero failed runs.
 *
 * That re-ratification is recorded HERE rather than in a chat log because the
 * first one was not: the operator approved this actor in a previous session,
 * the marker was flipped in a working tree, and the container was reclaimed
 * before it was committed. The database remembered the spend; git did not
 * remember the authorization, so a later session found a DRAFT marker and a
 * ledger that disagreed with it. Evidence that lives only in a terminal is
 * evidence that does not survive, which is the same lesson as Part XVI.5.
 *
 * The marker stays load-bearing in the other direction now, exactly as the A3
 * config markers did: a selection that silently regresses to DRAFT turns
 * `npm run check` red, because un-ratifying an actor is a canon decision
 * rather than a code change. Scale runs are open; ACTOR_SMOKE_TEST_CAP still
 * bounds the smoke door, and lib/budget.ts still gates every paid call.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const ACTOR_SELECTION_STATUS =
  'ratified v1 (2026-08-29, re-ratified for git 2026-08-30) — apify~instagram-profile-scraper · ' +
  'smoke H9wnMKKDF50CPcKWn $0.0052 3/3 packets · scale QI1TA8oJBccV0BHp3 32 handles $0.0806 · ' +
  'calibrate:refetch 32/32 $0.0312 · operator approved'

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

/**
 * ═══════════ RATIFIED — apify~instagram-hashtag-scraper ═══════════
 * Part 4b again, for the 4b channel this time, through the same sequence the
 * profile scraper passed on 2026-08-29.
 *
 * THE SMOKE TEST THAT RATIFIED IT (npm run smoke:hashtag, 2026-08-30):
 *   tag       #onlinefitnesscoach, limit 15
 *   charged   $0.0000 — Apify reported no usage at this size, against the $2
 *             ceiling. A free run is still a run: the mapping was observed.
 *   items     15 posts -> 14 distinct owner handles (93% unique at n=15)
 *   coverage  ownerUsername, ownerFullName, caption, likesCount,
 *             commentsCount, url, timestamp — 15/15 on every one
 *   samples   @bthevibefit (Life Transformation Coach), @shexfit_ (Fitness &
 *             Wellness coach), @kdfitnesscoaching (Online Coach),
 *             @staceyn_fitnessx (PT & Female Online Coach) — on thesis.
 *   noise     @flexfitnessdigital ("Websites for Fitness Coaches"),
 *             @smdesigns.coachtools, and a chiropractor. B2B vendors selling
 *             TO coaches are the characteristic 4b contaminant, and they are
 *             what the zero-cost triage exists to stop before paid enrichment.
 *
 * THE FINDING THAT MATTERS MOST: a hashtag post carries NO bio and NO follower
 * count. 4b is a HANDLE FEED, not a profile feed, so every handle it produces
 * needs a profile-actor enrich before it can be scored. That cost is real and
 * belongs in the projection rather than assumed away.
 *
 * The operator saw those handles and approved. The marker stays load-bearing
 * in the other direction now: a selection that silently regresses to DRAFT
 * turns `npm run check` red, because un-ratifying an actor is a canon decision.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export const HASHTAG_ACTOR_SELECTION_STATUS =
  'ratified v1 (2026-08-30) — apify~instagram-hashtag-scraper · smoke #onlinefitnesscoach limit 15 · ' +
  '$0.0000 charged · 15 posts -> 14 owners · all mapped fields present · operator approved'

/** True while no hashtag actor has passed its smoke test. Gates every scale run. */
export function hashtagActorSelectionIsDraft(): boolean {
  return HASHTAG_ACTOR_SELECTION_STATUS.startsWith('DRAFT')
}

export type HashtagActorCandidate = {
  id: string
  note: string
  /** Tags arrive with the leading '#'; most actors want them without. */
  buildInput: (tags: readonly string[], limit: number) => Record<string, unknown>
}

export const HASHTAG_ACTOR_CANDIDATES: readonly HashtagActorCandidate[] = [
  {
    id: 'apify~instagram-hashtag-scraper',
    note: 'Apify-official hashtag scraper. Takes bare tags; returns posts carrying ownerUsername.',
    buildInput: (tags, limit) => ({
      hashtags: tags.map((t) => t.replace(/^#/, '')),
      resultsLimit: limit,
    }),
  },
  {
    id: 'apify~instagram-scraper',
    note: 'Apify-official general IG scraper in hashtag search mode. Fallback if the hashtag actor is retired.',
    buildInput: (tags, limit) => ({
      search: tags.map((t) => t.replace(/^#/, '')).join(' '),
      searchType: 'hashtag',
      resultsType: 'posts',
      resultsLimit: limit,
    }),
  },
]

export const DEFAULT_HASHTAG_ACTOR = HASHTAG_ACTOR_CANDIDATES[0]
