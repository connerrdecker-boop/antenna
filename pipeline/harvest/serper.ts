/**
 * 4a — SELLER-EXHAUST SEARCH (PRIMARY — most robust, most novel).
 *
 * The query library over config/metros.ts terms · pagination <= 5 pages ·
 * URL-dedupe before fetching · handle/offer/price extraction from resolved
 * pages. instagram.com SERP hits are handled from URL + snippet ONLY — the
 * fetcher refuses IG hosts (Law 3); everything IG-side beyond the public SERP
 * comes from actors.
 */
import { METRO_TERMS } from '@/config/metros'
import { buildQueries, MAX_PAGES_PER_QUERY } from '@/config/queries'
import { HARVEST_COST } from '@/config/limits'
import { normalizeHandle, normalizeLinkUrl } from '@/lib/handle'
import { extractHandles, extractPlatformTells, extractPrices } from './extract'
import { fixtureSerpProvider, serperProvider } from './providers'
import type { AdapterParams, CandidateSeed, HarvestAdapter, SerpResult } from './types'

const IG_HOST = /(^|\.)instagram\.com$|(^|\.)instagr\.am$/i

function isInstagramUrl(url: string): boolean {
  try {
    return IG_HOST.test(new URL(url).hostname)
  } catch {
    return false
  }
}

function queriesFor(params: AdapterParams): string[] {
  // National library: no metro expansion. params.metro still stamps
  // provenance and still drives the 4b hashtag sweep, but it no longer
  // narrows what 4a searches for.
  const all = buildQueries()
  return params.maxQueries ? all.slice(0, params.maxQueries) : all
}

async function run(params: AdapterParams): Promise<CandidateSeed[]> {
  const log = params.log ?? console.log
  const provider = params.provider === 'real' ? serperProvider() : fixtureSerpProvider()
  const queries = queriesFor(params)
  log(`  ${queries.length} national queries (every query logged in harvest_runs.params)`)

  const seeds: CandidateSeed[] = []
  const seenUrls = new Set<string>() // Part 4a: dedupe on result URL before fetching

  for (const query of queries) {
    for (let page = 1; page <= MAX_PAGES_PER_QUERY; page++) {
      const results: SerpResult[] = await provider.search(query, page)
      if (!results.length) break // empty page ends pagination early
      for (const hit of results) {
        const urlKey = normalizeLinkUrl(hit.link) ?? hit.link
        if (seenUrls.has(urlKey)) continue
        seenUrls.add(urlKey)
        const seed = await hitToSeed(hit, query, provider.pageFetcher)
        if (seed) seeds.push(seed)
      }
    }
  }
  return seeds
}

async function hitToSeed(
  hit: SerpResult,
  query: string,
  pageFetcher: { fetch(url: string): Promise<{ status: 'ok' | 'failed'; text: string }> },
): Promise<CandidateSeed | null> {
  // instagram.com hit: the handle is IN the URL; snippet is the evidence.
  // Never fetched (Law 3).
  if (isInstagramUrl(hit.link)) {
    const handle = normalizeHandle(hit.link)
    if (!handle) return null // a /p/ or /reel/ URL — not a profile
    return {
      handle,
      ig_url: `https://www.instagram.com/${handle}/`,
      raw_evidence: `SERP: "${hit.title}" — ${hit.snippet}`,
      source: 'serper',
      source_detail: query,
    }
  }

  // Link-page hit (stan.store / linktr.ee / beacons / anything): resolve the
  // page, extract the coach's own handle plus offers/prices/tells.
  const page = await pageFetcher.fetch(hit.link)
  const haystack = `${hit.link}\n${hit.title}\n${hit.snippet}\n${page.text}`
  const handles = extractHandles(page.status === 'ok' ? page.text : `${hit.title} ${hit.snippet}`)
  const handle = handles[0] // the page's own handle; first instagram.com link wins
  if (!handle) {
    return {
      link_url: hit.link,
      raw_evidence: `SERP (no extractable handle): "${hit.title}" — ${hit.snippet}`,
      source: 'serper',
      source_detail: query,
    }
  }
  const prices = extractPrices(haystack)
  const tells = extractPlatformTells(haystack)
  return {
    handle,
    link_url: hit.link,
    link_contents: page.status === 'ok' ? page.text : null,
    link_fetch_status: page.status,
    raw_evidence: [
      `SERP: "${hit.title}" — ${hit.snippet}`,
      prices.length ? `prices: ${prices.join(', ')}` : null,
      tells.length ? `tells: ${tells.join(', ')}` : null,
    ].filter(Boolean).join(' · '),
    source: 'serper',
    source_detail: query,
  }
}

export const serperAdapter: HarvestAdapter = {
  name: 'serper',
  category: 'serp',
  run,
  describeRun(params: AdapterParams) {
    return { queries: queriesFor(params), maxPagesPerQuery: MAX_PAGES_PER_QUERY }
  },
  estimateCost(params: AdapterParams): number {
    // Worst case: every query paginates to the cap. Fixture runs still show
    // the estimate (it is what the REAL run would cost) but spend $0.
    return queriesFor(params).length * MAX_PAGES_PER_QUERY * HARVEST_COST.serpPerQuery
  },
}
