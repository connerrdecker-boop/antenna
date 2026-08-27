/**
 * 4c — COMMENTER / TAGGED HARVESTING (STRETCH). Sturdier graph proxies, no
 * login: commenters and tagged/collab accounts on the seed list in
 * config/seeds.ts — which the canon leaves EMPTY for the operator to fill
 * from 4a/4b's best finds + Christopher's orbit, post-confirmation.
 * Precision is low by design; the pre-score absorbs it.
 */
import { HARVEST_COST } from '@/config/limits'
import { SEED_ACCOUNTS, seedGateMessage } from '@/config/seeds'
import { PipelineHalt } from '@/lib/env'
import type { AdapterParams, CandidateSeed, HarvestAdapter } from './types'
import { apifyActorProvider, fixtureActorProvider } from './providers'

const DEFAULT_LIMIT_PER_SEED = 40

async function run(params: AdapterParams): Promise<CandidateSeed[]> {
  const log = params.log ?? console.log
  // The permanent seed gate (ratified A3): empty is the list's correct state,
  // and harvest halts on it every time — not once, not "until ratified".
  const seedList = SEED_ACCOUNTS[params.metro]
  if (!seedList.length) throw new PipelineHalt(seedGateMessage(params.metro))
  const provider = params.provider === 'real' ? apifyActorProvider() : fixtureActorProvider()
  const limit = params.limitPerTag ?? DEFAULT_LIMIT_PER_SEED
  log(`  ${seedList.length} seed account(s) × up to ${limit} commenters each (${provider.name})`)

  const items = await provider.commenterProfiles([...seedList], limit)
  return items.map((item): CandidateSeed => ({
    handle: item.username,
    link_url: item.externalUrl ?? undefined,
    raw_evidence: `commenter of @${item.via ?? '?'} · bio: ${(item.biography ?? '').slice(0, 140)}`,
    source: 'commenters',
    source_detail: `commenters of @${item.via ?? 'unknown-seed'}`,
    profile: {
      name: item.fullName ?? null,
      bio: item.biography ?? null,
      followerCount: item.followersCount ?? null,
      posts30d: item.postsLast30d ?? null,
      engagementProxy: item.engagementProxy ?? null,
    },
  }))
}

export const commentersAdapter: HarvestAdapter = {
  name: 'commenters',
  category: 'actors',
  run,
  describeRun(params: AdapterParams) {
    return { seedAccounts: [...SEED_ACCOUNTS[params.metro]], limitPerSeed: params.limitPerTag ?? DEFAULT_LIMIT_PER_SEED }
  },
  estimateCost(params: AdapterParams): number {
    return SEED_ACCOUNTS[params.metro].length * (params.limitPerTag ?? DEFAULT_LIMIT_PER_SEED) * HARVEST_COST.actorPerItem
  },
}
