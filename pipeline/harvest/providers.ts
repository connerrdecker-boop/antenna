/**
 * Harvest providers. Two implementations per external service:
 *   fixture — local JSON, runs tonight, zero network, zero spend
 *   real ——— the wired service; A3-build-half STUBS that halt naming the
 *            exact env var / account / ratification they are waiting on
 */
import { existsSync, readFileSync } from 'node:fs'
import { HASHTAG_LIBRARY_STATUS } from '@/config/hashtags'
import { QUERY_LIBRARY_STATUS } from '@/config/queries'
import { PipelineHalt } from '@/lib/env'
import { fetchLink } from '@/pipeline/lib/fetchLink'
import { classifyApifyFailure, runActor } from '@/pipeline/providers/apify'
import {
  ACTOR_RUN_BOUNDS, DEFAULT_HASHTAG_ACTOR, hashtagActorSelectionIsDraft,
  type HashtagActorCandidate,
} from '@/config/actors'
import { ACTOR_SMOKE_TEST_CAP, HARVEST_COST } from '@/config/limits'
import type { ActorProfileItem, ActorProvider, PageFetcher, SerpProvider, SerpResult } from './types'

// ------------------------------------------------------------ SERP: fixture

type SerpFixtureFile = {
  results: Record<string, SerpResult[]>
  pages: Record<string, string>
}

const SERP_FIXTURES = 'pipeline/fixtures/serp.json'

function loadSerpFixtures(): SerpFixtureFile {
  if (!existsSync(SERP_FIXTURES)) return { results: {}, pages: {} }
  return JSON.parse(readFileSync(SERP_FIXTURES, 'utf8')) as SerpFixtureFile
}

/**
 * Fixture matching is by template shape, not exact query string: the fixture
 * file keys results by the canon template with `{metro_term}` intact, plus the
 * term list each entry pretends to have matched. That keeps fixtures small
 * while the adapter still generates and logs every real query (Law 4).
 */
export function fixtureSerpProvider(): SerpProvider & { pageFetcher: PageFetcher } {
  let cache: SerpFixtureFile | null = null
  const load = () => (cache ??= loadSerpFixtures())
  return {
    name: 'serp:fixture',
    async search(query: string, page: number): Promise<SerpResult[]> {
      if (page > 1) return [] // fixtures are single-page; proves the empty-page stop
      const { results } = load()
      const hits: SerpResult[] = []
      for (const [key, rows] of Object.entries(results)) {
        const [template, ...terms] = key.split('||')
        if (!terms.length) continue
        for (const term of terms) {
          if (query === template.replaceAll('{metro_term}', term)) hits.push(...rows)
        }
      }
      return hits
    },
    pageFetcher: {
      name: 'pages:fixture',
      async fetch(url: string) {
        const text = load().pages[url]
        return text && text.length >= 500
          ? { status: 'ok' as const, text }
          : { status: 'failed' as const, text: '' }
      },
    },
  }
}

// --------------------------------------------------------------- SERP: real

/**
 * ════════════════════════════ WIRED (A2-national) ════════════════════════════
 * Serper.dev. POST https://google.serper.dev/search with X-API-KEY; map
 * data.organic[] -> SerpResult. Fallback if it ever dies: Google Programmable
 * Search — the queries are provider-agnostic strings by design (Part XI).
 *
 * The key travels in a HEADER, never a query string, for the same reason the
 * Apify token does: query strings reach proxy logs and error messages, and a
 * leaked key is a bill.
 *
 * Cost discipline: Part 4a pages to MAX_PAGES_PER_QUERY, and the adapter stops
 * early on an empty page rather than paying for five pages of nothing. The
 * ledger records the ESTIMATE for SERP (Serper bills per search against a
 * prepaid balance and returns no per-call charge), which is why
 * HARVEST_COST.serpPerQuery exists as canon rather than being read off a
 * receipt the way Apify's usageTotalUsd is.
 * ═══════════════════════════════════════════════════════════════════════
 */
const SERPER_ENDPOINT = 'https://google.serper.dev/search'

type SerperOrganic = { title?: string; link?: string; snippet?: string }

export function serperProvider(): SerpProvider & { pageFetcher: PageFetcher } {
  return {
    name: 'serp:serper',
    async search(query: string, page: number): Promise<SerpResult[]> {
      if (QUERY_LIBRARY_STATUS.startsWith('DRAFT')) {
        throw new PipelineHalt(
          'The query library (config/queries.ts) is still DRAFT — pending ratification (Part XV.8: ' +
          'red-pen before A3 runs them). The real Serper provider refuses to spend until it is ratified. ' +
          'Fixture runs remain available: --provider=fixture.',
        )
      }
      const key = process.env.SERPER_API_KEY?.trim()
      if (!key) {
        throw new PipelineHalt(
          `SERPER_API_KEY is not set — the real SERP provider cannot run (query was: ${query.slice(0, 60)}…).\n\n` +
          'To fix: create an account at serper.dev (free starter credits, then ~$1/1K searches),\n' +
          'and add to .env.local:\n\n  SERPER_API_KEY=...\n\n' +
          'Fixture runs remain available meanwhile: --provider=fixture.',
        )
      }

      let res: Response
      try {
        res = await fetch(SERPER_ENDPOINT, {
          method: 'POST',
          headers: { 'X-API-KEY': key, 'content-type': 'application/json' },
          body: JSON.stringify({ q: query, page }),
        })
      } catch (e) {
        throw new PipelineHalt(
          `Could not reach ${SERPER_ENDPOINT}: ${e instanceof Error ? e.message : String(e)}. ` +
          'Nothing was charged. If this is a sandbox, the host may not be in the egress allowlist.',
        )
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        // Reused deliberately despite the Apify-specific name: the tell it
        // encodes is provider-agnostic and hard-won — a sandbox refusing to
        // carry the request answers 403 exactly as a rejected key does, and
        // reporting the first as the second sends the operator off to rotate a
        // credential that was never implicated.
        switch (classifyApifyFailure(res, body)) {
          case 'egress':
            throw new PipelineHalt(
              `The environment refused the request to ${SERPER_ENDPOINT} (HTTP ${res.status}) — this is an ` +
              'egress policy block, NOT a bad key. The host needs to be in the allowlist. Nothing was charged.',
            )
          case 'auth':
            throw new PipelineHalt(
              `Serper rejected the key (HTTP ${res.status}). Check SERPER_API_KEY against serper.dev → ` +
              'API key. Nothing was charged.',
            )
          case 'credit':
            throw new PipelineHalt(
              'Serper reports the account is out of credit (HTTP 402). Top up at serper.dev, or run ' +
              '--provider=fixture meanwhile. Nothing was charged.',
            )
          default:
            if (res.status === 429) {
              throw new PipelineHalt(
                'Serper rate-limited the run (HTTP 429). Nothing is lost — wait and re-run; harvest ' +
                'resumes from a fresh run and cross-run dedupe keeps the repeat cheap.',
              )
            }
            throw new PipelineHalt(`Serper returned HTTP ${res.status}: ${body.slice(0, 300)}`)
        }
      }

      const json = (await res.json()) as { organic?: SerperOrganic[] }
      // A result with no link is unusable downstream (the adapter dedupes on
      // URL and resolves the page), so it is dropped here rather than carried
      // as an empty string that would collide with every other empty one.
      return (json.organic ?? [])
        .filter((o): o is SerperOrganic & { link: string } => typeof o.link === 'string' && o.link.length > 0)
        .map((o) => ({ title: o.title ?? '', link: o.link, snippet: o.snippet ?? '' }))
    },
    pageFetcher: {
      name: 'pages:live',
      fetch: (url: string) => fetchLink(url),
    },
  }
}

// -------------------------------------------------------------- actor: fixture

type ActorFixtureFile = {
  hashtag_profiles: Record<string, ActorProfileItem[]>
  commenter_profiles: Record<string, ActorProfileItem[]>
}

const ACTOR_FIXTURES = 'pipeline/fixtures/actor.json'

export function fixtureActorProvider(): ActorProvider {
  let cache: ActorFixtureFile | null = null
  const load = () =>
    (cache ??= existsSync(ACTOR_FIXTURES)
      ? (JSON.parse(readFileSync(ACTOR_FIXTURES, 'utf8')) as ActorFixtureFile)
      : { hashtag_profiles: {}, commenter_profiles: {} })
  return {
    name: 'actor:fixture',
    async hashtagProfiles(hashtags: string[], limitPerTag: number): Promise<ActorProfileItem[]> {
      const { hashtag_profiles } = load()
      return hashtags.flatMap((tag) => (hashtag_profiles[tag] ?? []).slice(0, limitPerTag))
    },
    async commenterProfiles(seedAccounts: string[], limit: number): Promise<ActorProfileItem[]> {
      const { commenter_profiles } = load()
      return seedAccounts.flatMap((seed) =>
        (commenter_profiles[seed] ?? []).slice(0, limit).map((p) => ({ ...p, via: seed })),
      )
    },
  }
}

// ----------------------------------------------------------------- actor: real

/**
 * ════════════════════════════ WIRING POINT ════════════════════════════
 * Apify-class actor, NO LOGIN, no cookies ever (Law 3). At wiring time:
 *   1. select a currently-maintained "Instagram hashtag scraper" /
 *      "Instagram profile scraper" class actor (names churn — check the day of)
 *   2. SMOKE-TEST with a <= $2 run (ACTOR_SMOKE_TEST_CAP) and show the
 *      operator results BEFORE any scale run (Part 4b canon)
 *   3. costs through ensureBudget('actors', …) before, recordSpend after
 * Blocked on: APIFY_TOKEN in .env.local (apify.com account) + the hashtag
 * library shedding its DRAFT marker (Part XV.8).
 * ═══════════════════════════════════════════════════════════════════════
 */
/**
 * ═══════════════════════════ WIRED (A2-national) ═══════════════════════════
 * The 4b hashtag-class actor, through the same runActor() client the ratified
 * profile scraper uses — same Law 3 forbidden-key refusal, same run bounds,
 * same receipt.
 *
 * TWO GATES, in this order:
 *   1. the hashtag LIBRARY must be ratified (config/hashtags.ts)
 *   2. the hashtag ACTOR SELECTION must be ratified (config/actors.ts), and
 *      until it is, only the smoke door opens — Part 4b's "smoke-test with a
 *      <= $2 run and show the operator results BEFORE any scale run".
 *
 * A hashtag scraper returns POSTS. The mapping below pulls the owner's
 * username off each post and dedupes, because 4b's product is a handle feed;
 * whatever profile data rides along is a bonus the smoke test measures rather
 * than something the mapper may invent.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export type ApifyActorOpts = {
  /** The one door open while the selection is DRAFT. Capped at $2. */
  smokeTest?: boolean
  candidate?: HashtagActorCandidate
  /** Called with the raw items, for the smoke test's packet-quality report. */
  onItems?: (items: Record<string, unknown>[]) => void
  /** Called with Apify's own figure for what the run cost. */
  onSpend?: (usd: number) => void
}

/** What a hashtag post looks like across the candidate actors, loosely. */
type HashtagPost = {
  ownerUsername?: string
  ownerFullName?: string
  ownerId?: string
  caption?: string
  hashtags?: string[]
  likesCount?: number
  commentsCount?: number
  url?: string
  timestamp?: string
}

export function apifyActorProvider(opts: ApifyActorOpts = {}): ActorProvider {
  const candidate = opts.candidate ?? DEFAULT_HASHTAG_ACTOR

  const gate = (what: string): void => {
    if (HASHTAG_LIBRARY_STATUS.startsWith('DRAFT')) {
      throw new PipelineHalt(
        'The hashtag library (config/hashtags.ts) is still DRAFT — pending ratification (Part XV.8). ' +
        'The real actor provider refuses to spend until it is ratified. Fixture runs remain available.',
      )
    }
    if (!process.env.APIFY_TOKEN?.trim()) {
      throw new PipelineHalt(
        `APIFY_TOKEN is not set — the real actor provider cannot run (${what}).\n\n` +
        'To fix: create an account at apify.com (small free credit, then ~$1-3/1K profiles),\n' +
        'and add to .env.local:\n\n  APIFY_TOKEN=apify_api_...\n\n' +
        'Fixture runs remain available meanwhile: --provider=fixture.',
      )
    }
    if (hashtagActorSelectionIsDraft() && !opts.smokeTest) {
      throw new PipelineHalt(
        'The HASHTAG actor selection (config/actors.ts) is DRAFT — no hashtag actor has passed its smoke ' +
        'test yet, so a SCALE run refuses to spend (Part 4b: smoke-test with a <= $2 run and show the ' +
        'operator results BEFORE any scale run).\n\nRun `npm run smoke:hashtag` first. Nothing was charged.',
      )
    }
  }

  return {
    name: `actor:${candidate.id}`,

    async hashtagProfiles(tags: readonly string[], limit: number): Promise<ActorProfileItem[]> {
      gate('hashtag profiles')
      if (!tags.length) return []

      const estimate = Math.max(0.05, tags.length * limit * HARVEST_COST.actorPerItem)
      const cap = opts.smokeTest ? ACTOR_SMOKE_TEST_CAP : estimate * 4

      const result = await runActor({
        actorId: candidate.id,
        input: candidate.buildInput(tags, limit),
        token: process.env.APIFY_TOKEN!.trim(),
        maxChargeUsd: cap,
        timeoutSecs: ACTOR_RUN_BOUNDS.timeoutSecs,
        memoryMbytes: ACTOR_RUN_BOUNDS.memoryMbytes,
      })

      opts.onItems?.(result.items)
      opts.onSpend?.(result.usageUsd)

      if (result.status !== 'SUCCEEDED' && !result.items.length) {
        throw new PipelineHalt(
          `Apify run ${result.runId} finished ${result.status} with no items. ` +
          `Charged $${result.usageUsd.toFixed(4)} (recorded). Check apify.com/view/runs/${result.runId}.`,
        )
      }

      // Posts -> one item per distinct owner. First post per owner wins, so the
      // metrics that ride along belong to a real post rather than an average of
      // several — an invented aggregate is exactly what Law 9's write
      // discipline exists to keep out of the Observatory.
      const byOwner = new Map<string, ActorProfileItem>()
      for (const raw of result.items as HashtagPost[]) {
        const username = typeof raw.ownerUsername === 'string' ? raw.ownerUsername.trim().toLowerCase() : ''
        if (!username || byOwner.has(username)) continue
        // PER-TAG ATTRIBUTION. The actor is called once with every tag, so
        // stamping the whole list would make per-tag yield unrecoverable —
        // and per-tag yield is exactly what the next wave's tag list gets
        // designed from. Each post carries its OWN hashtags, so the searched
        // tags it actually matched are recoverable; the full list is the
        // honest fallback when a post carries none.
        const own = new Set((raw.hashtags ?? []).map((h) => `#${String(h).replace(/^#/, '').toLowerCase()}`))
        const matched = tags.filter((t) => own.has(t.toLowerCase()))
        byOwner.set(username, {
          username,
          fullName: raw.ownerFullName ?? null,
          // A hashtag post carries no bio and no follower count. Reporting
          // null is the honest answer; the profile actor fills them in at
          // enrich time, and that cost belongs in the projection.
          biography: null,
          followersCount: null,
          postsLast30d: null,
          engagementProxy: null,
          externalUrl: null,
          via: `hashtag ${(matched.length ? matched : tags).join(' ')}`,
        })
      }
      return [...byOwner.values()]
    },

    async commenterProfiles(): Promise<never> {
      throw new PipelineHalt(
        'Commenter harvesting (4c) is gated on a seed list, which is ratified EMPTY (config/seeds.ts). ' +
        'This is a permanent gate, not a wiring point.',
      )
    },
  }
}
