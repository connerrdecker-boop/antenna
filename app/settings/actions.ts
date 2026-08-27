'use server'
/**
 * /settings mutations: estimate (free, always) and run (budget-gated) per
 * adapter. The estimate is shown BEFORE confirm (Part XIII A3); the run
 * re-computes it server-side and gates on it — the client number is display,
 * never authority.
 */
import { revalidatePath } from 'next/cache'
import { loadEnvLocal, PipelineHalt } from '@/lib/env'
import { commentersAdapter } from '@/pipeline/harvest/commenters'
import { hashtagsAdapter } from '@/pipeline/harvest/hashtags'
import { runHarvest, type IngestOutcome } from '@/pipeline/harvest/ingest'
import { serperAdapter } from '@/pipeline/harvest/serper'
import type { AdapterParams, HarvestAdapter } from '@/pipeline/harvest/types'

const ADAPTERS: Record<string, HarvestAdapter> = {
  serper: serperAdapter,
  hashtags: hashtagsAdapter,
  commenters: commentersAdapter,
}

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string; halt?: boolean }

function parseParams(adapterName: string, metro: string, provider: string): {
  adapter: HarvestAdapter
  params: AdapterParams
} {
  const adapter = ADAPTERS[adapterName]
  if (!adapter) throw new Error(`unknown adapter "${adapterName}"`)
  if (!['nyc', 'sofla'].includes(metro)) throw new Error(`unknown metro "${metro}"`)
  if (!['fixture', 'real'].includes(provider)) throw new Error(`unknown provider "${provider}"`)
  return { adapter, params: { metro: metro as 'nyc' | 'sofla', provider: provider as 'fixture' | 'real' } }
}

export type EstimateData = {
  estCost: number
  detail: string
}

export async function estimateRun(
  adapterName: string,
  metro: string,
  provider: string,
): Promise<ActionResult<EstimateData>> {
  try {
    const { adapter, params } = parseParams(adapterName, metro, provider)
    const described = adapter.describeRun(params)
    const detail =
      'queries' in described ? `${(described.queries as string[]).length} queries × up to ${String(described.maxPagesPerQuery)} pages`
      : 'hashtags' in described ? `${(described.hashtags as string[]).length} hashtags × up to ${String(described.limitPerTag)} profiles`
      : `${(described.seedAccounts as string[]).length} seed account(s) × up to ${String(described.limitPerSeed)} commenters`
    return { ok: true, data: { estCost: adapter.estimateCost(params), detail } }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export type RunData = IngestOutcome & { log: string[] }

export async function runAdapter(
  adapterName: string,
  metro: string,
  provider: string,
): Promise<ActionResult<RunData>> {
  try {
    loadEnvLocal()
    const { adapter, params } = parseParams(adapterName, metro, provider)
    const log: string[] = []
    const outcome = await runHarvest(adapter, { ...params, log: (l) => log.push(l) })
    revalidatePath('/settings')
    revalidatePath('/pipeline')
    revalidatePath('/metrics')
    return { ok: true, data: { ...outcome, log } }
  } catch (e) {
    revalidatePath('/settings')
    if (e instanceof PipelineHalt) return { ok: false, error: e.message, halt: true }
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
