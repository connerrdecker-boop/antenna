/**
 * 4b — HASHTAG + LOCATION MINING (SECONDARY). Commercial data actors, no
 * login. Inputs from config/hashtags.ts (DRAFT until red-penned); outputs
 * mapped to CandidateSeed; expect flakiness and let Score do the filtering.
 */
import { hashtagsFor } from '@/config/hashtags'
import { HARVEST_COST } from '@/config/limits'
import type { AdapterParams, CandidateSeed, HarvestAdapter } from './types'
import { apifyActorProvider, fixtureActorProvider } from './providers'

const DEFAULT_LIMIT_PER_TAG = 25

async function run(params: AdapterParams): Promise<CandidateSeed[]> {
  const log = params.log ?? console.log
  const provider = params.provider === 'real' ? apifyActorProvider() : fixtureActorProvider()
  const tags = hashtagsFor(params.metro)
  const limit = params.limitPerTag ?? DEFAULT_LIMIT_PER_TAG
  log(`  ${tags.length} hashtags × up to ${limit} profiles each (${provider.name})`)

  const items = await provider.hashtagProfiles(tags, limit)
  return items.map((item): CandidateSeed => ({
    handle: item.username,
    link_url: item.externalUrl ?? undefined,
    raw_evidence: `hashtag actor: @${item.username} · ${item.followersCount ?? '?'} followers · bio: ${(item.biography ?? '').slice(0, 140)}`,
    source: 'hashtags',
    source_detail: item.via ?? `${params.metro} hashtag sweep`,
    profile: {
      name: item.fullName ?? null,
      bio: item.biography ?? null,
      followerCount: item.followersCount ?? null,
      posts30d: item.postsLast30d ?? null,
      engagementProxy: item.engagementProxy ?? null,
    },
  }))
}

export const hashtagsAdapter: HarvestAdapter = {
  name: 'hashtags',
  category: 'actors',
  run,
  describeRun(params: AdapterParams) {
    return { hashtags: hashtagsFor(params.metro), limitPerTag: params.limitPerTag ?? DEFAULT_LIMIT_PER_TAG }
  },
  estimateCost(params: AdapterParams): number {
    const tags = hashtagsFor(params.metro)
    return tags.length * (params.limitPerTag ?? DEFAULT_LIMIT_PER_TAG) * HARVEST_COST.actorPerItem
  },
}
