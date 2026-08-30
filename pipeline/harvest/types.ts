/**
 * PART IV — the adapter contract, verbatim:
 *   every adapter exports { name, run(params): Promise<CandidateSeed[]> }
 *   CandidateSeed = { handle?, ig_url?, link_url?, raw_evidence, source, source_detail }
 * The pipeline dedupes, stamps provenance, inserts as `sourced`. A broken
 * adapter is swapped, not mourned.
 */

export type CandidateSeed = {
  handle?: string
  ig_url?: string
  link_url?: string
  raw_evidence: string
  source: string
  source_detail: string
  /**
   * Beyond the canon seed: profile data the adapter genuinely observed
   * (hashtag actors return bios and follower counts). Stored on the candidate
   * so the bio-only pre-score has something to read, and snapshotted into the
   * Observatory (Part IX: every harvest writes a snapshot — when there is
   * something to snapshot).
   */
  profile?: {
    name?: string | null
    bio?: string | null
    followerCount?: number | null
    posts30d?: number | null
    engagementProxy?: number | null
  }
  /** Link-page text already resolved (fixture path, or a fetched page). */
  link_contents?: string | null
  link_fetch_status?: 'ok' | 'failed' | 'skipped'
}

export type AdapterParams = {
  metro: 'nyc' | 'sofla'
  /** fixture tonight; real once keys + ratifications exist. */
  provider: 'fixture' | 'real'
  /** Optional narrowing for a cheaper run. */
  maxQueries?: number
  /** Cap the hashtag sweep to the first N tags — the 4b twin of maxQueries. */
  maxTags?: number
  limitPerTag?: number
  log?: (line: string) => void
  /**
   * An adapter whose provider returns a RECEIPT calls this with the actual
   * charge. Serper bills prepaid per search and reports no per-call cost, so
   * its run banks the estimate; an Apify actor reports usageTotalUsd, and
   * banking an estimate over a receipt would make the Law 6 ledger disagree
   * with the bill in the one direction nobody notices — under.
   */
  onSpend?: (usd: number) => void
}

export interface HarvestAdapter {
  name: string
  run(params: AdapterParams): Promise<CandidateSeed[]>
  /** The pre-run estimate shown BEFORE confirm (/settings) and budget-gated. */
  estimateCost(params: AdapterParams): number
  /** Which spend category the run draws from (Part X). */
  category: 'serp' | 'actors'
  /**
   * What this run will actually ask the provider — logged verbatim into
   * harvest_runs.params (Part 4a: "log every query"; Law 4 provenance).
   */
  describeRun(params: AdapterParams): Record<string, unknown>
}

// ---------------------------------------------------------------- providers

/** One SERP page of organic results. */
export type SerpResult = {
  title: string
  link: string
  snippet: string
}

export interface SerpProvider {
  readonly name: string
  search(query: string, page: number): Promise<SerpResult[]>
}

/** What an IG-side data actor returns per profile, mapped from actor output. */
export type ActorProfileItem = {
  username: string
  fullName?: string | null
  biography?: string | null
  followersCount?: number | null
  postsLast30d?: number | null
  engagementProxy?: number | null
  externalUrl?: string | null
  /** For commenter runs: which seed account surfaced this profile. */
  via?: string | null
}

export interface ActorProvider {
  readonly name: string
  hashtagProfiles(hashtags: string[], limitPerTag: number): Promise<ActorProfileItem[]>
  commenterProfiles(seedAccounts: string[], limit: number): Promise<ActorProfileItem[]>
}

/** Resolves a hit's page to text — the real one is lib/fetchLink, rate-limited. */
export interface PageFetcher {
  readonly name: string
  fetch(url: string): Promise<{ status: 'ok' | 'failed'; text: string }>
}
