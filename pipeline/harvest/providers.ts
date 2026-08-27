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
 * ════════════════════════════ WIRING POINT ════════════════════════════
 * Serper.dev (fallback: Google Programmable Search — queries are
 * provider-agnostic strings, Part XI). Wire here: POST https://google.serper.dev/search
 * with X-API-KEY, q, page; map data.organic[] -> SerpResult. Blocked on:
 *   1. SERPER_API_KEY in .env.local (serper.dev account, personal email/card)
 *   2. the query library shedding its DRAFT marker (Part XV.8 red-pen)
 * ═══════════════════════════════════════════════════════════════════════
 */
export function serperProvider(): SerpProvider & { pageFetcher: PageFetcher } {
  return {
    name: 'serp:serper',
    async search(query: string): Promise<never> {
      if (QUERY_LIBRARY_STATUS.startsWith('DRAFT')) {
        throw new PipelineHalt(
          'The query library (config/queries.ts) is still DRAFT — pending ratification (Part XV.8: ' +
          'red-pen before A3 runs them). The real Serper provider refuses to spend until it is ratified. ' +
          'Fixture runs remain available: --provider=fixture.',
        )
      }
      if (!process.env.SERPER_API_KEY?.trim()) {
        throw new PipelineHalt(
          `SERPER_API_KEY is not set — the real SERP provider cannot run (query was: ${query.slice(0, 60)}…).\n\n` +
          'To fix: create an account at serper.dev (free starter credits, then ~$1/1K searches),\n' +
          'and add to .env.local:\n\n  SERPER_API_KEY=...\n\n' +
          'Fixture runs remain available meanwhile: --provider=fixture.',
        )
      }
      throw new PipelineHalt(
        'Serper HTTP wiring lands when the key exists to test against — this is the A3 wiring point ' +
        '(pipeline/harvest/providers.ts, serperProvider).',
      )
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
export function apifyActorProvider(): ActorProvider {
  const halt = (what: string): never => {
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
        'Then the wiring flow is: pick a maintained no-login actor, smoke-test <= $2, show results, ' +
        'and only then scale (Part 4b). Fixture runs remain available meanwhile: --provider=fixture.',
      )
    }
    throw new PipelineHalt(
      'Actor selection + smoke-test happen when the token exists — this is the A3 wiring point ' +
      '(pipeline/harvest/providers.ts, apifyActorProvider).',
    )
  }
  return {
    name: 'actor:apify',
    async hashtagProfiles(): Promise<never> {
      return halt('hashtag profiles')
    },
    async commenterProfiles(): Promise<never> {
      return halt('commenter profiles')
    },
  }
}
