/**
 * 4b — HASHTAG + LOCATION MINING (SECONDARY). Commercial data actors, no
 * login. Inputs from config/hashtags.ts (DRAFT until red-penned); outputs
 * mapped to CandidateSeed; expect flakiness and let Score do the filtering.
 */
import { nationalHashtags } from '@/config/hashtags'
import { HARVEST_COST } from '@/config/limits'
import type { AdapterParams, CandidateSeed, HarvestAdapter } from './types'
import { apifyActorProvider, fixtureActorProvider } from './providers'

const DEFAULT_LIMIT_PER_TAG = 25

/**
 * The tags this run will sweep. National core by default — metro tags became
 * opt-in at the national ratification, since metro is a 5-point bonus rather
 * than a gate and a national run should not spend actor budget on them.
 * `maxTags` narrows the sweep for a bounded pilot.
 */
function tagsFor(params: AdapterParams): string[] {
  const all = nationalHashtags()
  return params.maxTags ? all.slice(0, params.maxTags) : all
}

async function run(params: AdapterParams): Promise<CandidateSeed[]> {
  const log = params.log ?? console.log
  const provider = params.provider === 'real' ? apifyActorProvider() : fixtureActorProvider()
  const tags = tagsFor(params)
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
    return { hashtags: tagsFor(params), limitPerTag: params.limitPerTag ?? DEFAULT_LIMIT_PER_TAG }
  },
  estimateCost(params: AdapterParams): number {
    return tagsFor(params).length * (params.limitPerTag ?? DEFAULT_LIMIT_PER_TAG) * HARVEST_COST.actorPerItem
  },
}
