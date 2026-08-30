/**
 * Harvest runner.
 *
 *   npm run harvest -- --adapter=serper --metro=nyc               (fixture default)
 *   npm run harvest -- --adapter=hashtags --metro=sofla --provider=real
 *   npm run harvest -- --adapter=commenters --metro=nyc
 *
 * Every run: budget-gated before provider work, harvest_runs + spend rows
 * written, candidates deduped and provenance-stamped, inserted as sourced.
 * Halts (missing keys, DRAFT configs, empty seed list, budget caps) are clean
 * stops with instructions — exit 2. Real errors crash loudly — exit 1.
 */
import { loadEnvLocal, PipelineHalt } from '@/lib/env'
import { commentersAdapter } from '@/pipeline/harvest/commenters'
import { hashtagsAdapter } from '@/pipeline/harvest/hashtags'
import { runHarvest } from '@/pipeline/harvest/ingest'
import { serperAdapter } from '@/pipeline/harvest/serper'
import type { AdapterParams, HarvestAdapter } from '@/pipeline/harvest/types'
import { runMigrations } from './migrate'

const ADAPTERS: Record<string, HarvestAdapter> = {
  serper: serperAdapter,
  hashtags: hashtagsAdapter,
  commenters: commentersAdapter,
}

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.split('=').slice(1).join('=') : null
}

async function main() {
  loadEnvLocal()
  runMigrations()

  const adapterName = arg('adapter') ?? 'serper'
  const adapter = ADAPTERS[adapterName]
  if (!adapter) {
    console.error(`unknown adapter "${adapterName}" — one of: ${Object.keys(ADAPTERS).join(', ')}`)
    process.exit(1)
  }
  const metro = (arg('metro') ?? 'nyc') as AdapterParams['metro']
  if (!['nyc', 'sofla'].includes(metro)) {
    console.error(`unknown metro "${metro}" — nyc or sofla (wave three adds config, Part 4.5)`)
    process.exit(1)
  }
  const params: AdapterParams = {
    metro,
    provider: (arg('provider') ?? 'fixture') as AdapterParams['provider'],
    maxQueries: arg('max-queries') ? Number(arg('max-queries')) : undefined,
    maxTags: arg('max-tags') ? Number(arg('max-tags')) : undefined,
    limitPerTag: arg('limit') ? Number(arg('limit')) : undefined,
  }

  console.log(`harvest — ${adapter.name} · ${metro} · ${params.provider}`)
  console.log(`estimated cost (what a REAL run would spend): $${adapter.estimateCost(params).toFixed(2)}`)
  const outcome = await runHarvest(adapter, params)
  console.log(
    `\nharvest_runs #${outcome.runId}: found ${outcome.itemsFound} · new ${outcome.itemsNew} · ` +
    `duplicates ${outcome.duplicates} · unusable ${outcome.unusable} · spent $${outcome.spentActual.toFixed(2)}`,
  )
  console.log('new candidates are `sourced` — npm run pipeline sends them to pre-score')
}

main().catch((e: unknown) => {
  if (e instanceof PipelineHalt) {
    console.error(`\n■ HARVEST HALT\n\n${e.message}\n`)
    process.exit(2)
  }
  console.error(e)
  process.exit(1)
})
