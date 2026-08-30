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

  // PER-QUERY YIELD, measured on every run rather than only in a pilot.
  // The two-wave plan is designed around yield-per-query — wave two's variant
  // expansion is supposed to come from wave one's measurements — and a number
  // that is only collected when someone remembers to look is a number that
  // will not exist when the decision needs it.
  const stats: QueryStat[] = []

  for (const query of queries) {
    const stat: QueryStat = { query, raw: 0, pages: 0, igProfiles: 0, nonIg: 0, dupeUrls: 0, handles: 0 }
    for (let page = 1; page <= MAX_PAGES_PER_QUERY; page++) {
      const results: SerpResult[] = await provider.search(query, page)
      if (!results.length) break // empty page ends pagination early
      stat.pages++
      stat.raw += results.length
      for (const hit of results) {
        const urlKey = normalizeLinkUrl(hit.link) ?? hit.link
        if (seenUrls.has(urlKey)) { stat.dupeUrls++; continue }
        seenUrls.add(urlKey)
        if (isInstagramUrl(hit.link)) stat.igProfiles++
        else stat.nonIg++
        const seed = await hitToSeed(hit, query, provider.pageFetcher)
        if (seed) {
          seeds.push(seed)
          if (seed.handle) stat.handles++
        }
      }
    }
    stats.push(stat)
  }

  log('')
  log('  per-query yield (raw · pages · IG-url · non-IG · url-dupes · handles):')
  for (const st of stats) {
    log(
      `    ${String(st.raw).padStart(3)} · ${st.pages}p · ${String(st.igProfiles).padStart(2)} · ` +
      `${String(st.nonIg).padStart(2)} · ${String(st.dupeUrls).padStart(2)} · ${String(st.handles).padStart(2)}   ` +
      st.query.slice(0, 62),
    )
  }
  const tot = stats.reduce((a, st) => ({
    raw: a.raw + st.raw, ig: a.ig + st.igProfiles, non: a.non + st.nonIg,
    dup: a.dup + st.dupeUrls, h: a.h + st.handles,
  }), { raw: 0, ig: 0, non: 0, dup: 0, h: 0 })
  log(
    `  TOTAL raw ${tot.raw} · IG-url ${tot.ig} · non-IG ${tot.non} · url-dupes ${tot.dup} · handles ${tot.h}` +
    `  =>  ${(tot.h / Math.max(1, queries.length)).toFixed(2)} handles/query, ` +
    `${tot.raw ? ((tot.h / tot.raw) * 100).toFixed(1) : '0.0'}% of raw results yield a handle`,
  )
  return seeds
}

/** One query's measured yield. Logged every run; see the note above. */
type QueryStat = {
  query: string
  raw: number
  pages: number
  igProfiles: number
  nonIg: number
  dupeUrls: number
  handles: number
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
