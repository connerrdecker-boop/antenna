/**
 * The harvest ingest — where adapter output becomes candidates.
 *
 * The pipeline (Part IV): dedupes, stamps provenance (Law 4: source, query,
 * fetch date), inserts as `sourced`. Every run writes a harvest_runs row
 * (provenance + per-source qualification metrics + cost ledger feed) and a
 * spend row (Part X — $0.00 actuals for fixture runs, which documents the run
 * without corrupting cost totals). Budget is gated BEFORE the provider does
 * any work.
 */
import { getSqlite } from '@/db/connection'
import { recordObservation } from '@/db/observations'
import { igUrlFor, linkDomainOf, normalizeHandle } from '@/lib/handle'
import { isForgotten } from '@/lib/tombstones'
import { ensureBudget, recordSpend } from '@/pipeline/lib/budget'
import { PipelineHalt } from '@/lib/env'
import type { AdapterParams, CandidateSeed, HarvestAdapter } from './types'

export type IngestOutcome = {
  runId: number
  itemsFound: number
  itemsNew: number
  duplicates: number
  unusable: number
  estCost: number
  spentActual: number
}

export async function runHarvest(
  adapter: HarvestAdapter,
  params: AdapterParams,
): Promise<IngestOutcome> {
  const sqlite = getSqlite()
  const log = params.log ?? ((l: string) => console.log(l))
  const estCost = adapter.estimateCost(params)

  // Law 6: the gate comes BEFORE any provider work.
  ensureBudget(adapter.category, estCost)

  // An adapter may report a real receipt; otherwise the estimate stands.
  let reported: number | null = null
  const paramsWithSpend: AdapterParams = { ...params, onSpend: (usd) => { reported = usd } }

  const startedAt = new Date().toISOString()
  // Law 4 / Part 4a: params carries EVERY query/hashtag/seed the run asks for.
  const paramsJson = JSON.stringify({
    metro: params.metro,
    provider: params.provider,
    maxQueries: params.maxQueries ?? null,
    limitPerTag: params.limitPerTag ?? null,
    ...adapter.describeRun(params),
  })
  const runInfo = sqlite
    .prepare(
      `INSERT INTO harvest_runs (adapter, params, started_at, status, est_cost)
       VALUES (?, ?, ?, 'running', ?)`,
    )
    .run(adapter.name, paramsJson, startedAt, estCost)
  const runId = Number(runInfo.lastInsertRowid)
  log(`run #${runId} · ${adapter.name} · ${params.provider} · est $${estCost.toFixed(2)}`)

  try {
    const seeds = await adapter.run(paramsWithSpend)
    const { itemsNew, duplicates, unusable } = ingestSeeds(seeds, runId, log)

    // Fixture runs cost nothing; real providers will report receipts at
    // wiring time. Either way the run is on the ledger (Part X).
    const spentActual = params.provider === 'fixture' ? 0 : (reported ?? estCost)
    recordSpend(
      adapter.category,
      spentActual,
      `harvest:${runId}`,
      `${adapter.name} (${params.provider}) found=${seeds.length} new=${itemsNew}`,
    )

    sqlite
      .prepare(
        `UPDATE harvest_runs SET status='ok', finished_at=?, items_found=?, items_new=? WHERE id=?`,
      )
      .run(new Date().toISOString(), seeds.length, itemsNew, runId)

    log(`run #${runId} done · found ${seeds.length} · new ${itemsNew} · dupes ${duplicates} · unusable ${unusable}`)
    return { runId, itemsFound: seeds.length, itemsNew, duplicates, unusable, estCost, spentActual }
  } catch (e) {
    sqlite
      .prepare(`UPDATE harvest_runs SET status='failed', finished_at=?, error=? WHERE id=?`)
      .run(new Date().toISOString(), e instanceof Error ? e.message : String(e), runId)
    if (e instanceof PipelineHalt) log(`run #${runId} HALTED: ${e.message.split('\n')[0]}`)
    throw e
  }
}

function ingestSeeds(
  seeds: CandidateSeed[],
  runId: number,
  log: (l: string) => void,
): { itemsNew: number; duplicates: number; unusable: number } {
  const sqlite = getSqlite()
  const now = new Date().toISOString()
  let itemsNew = 0
  let duplicates = 0
  let unusable = 0
  const seenThisRun = new Set<string>()

  const insert = sqlite.prepare(
    `INSERT INTO candidates (
       handle, ig_url, name, bio, follower_count, link_url, link_domain,
       link_contents, link_fetch_status, source, source_detail,
       first_seen, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const exists = sqlite.prepare('SELECT id FROM candidates WHERE handle = ?')

  const tx = sqlite.transaction(() => {
    for (const seed of seeds) {
      const handle = normalizeHandle(seed.handle ?? seed.ig_url ?? '')
      if (!handle) {
        unusable++
        continue
      }
      // Law 5: a forgotten handle is never re-collected. This door inserts
      // through its own prepared statement rather than addCandidates(), so it
      // needs its own tombstone check — the erasure guarantee has to hold at
      // every door, not just the one that was easiest to remember.
      if (isForgotten(handle)) {
        unusable++
        continue
      }
      // Dedupe: within this run, then against every existing candidate — an
      // existing row is never duplicated and never overwritten (Part 4d rule,
      // applied to harvest too).
      if (seenThisRun.has(handle) || exists.get(handle)) {
        duplicates++
        seenThisRun.add(handle)
        continue
      }
      seenThisRun.add(handle)

      const p = seed.profile
      insert.run(
        handle,
        seed.ig_url ?? igUrlFor(handle),
        p?.name ?? null,
        p?.bio ?? null,
        p?.followerCount ?? null,
        seed.link_url ?? null,
        linkDomainOf(seed.link_url ?? null),
        seed.link_contents ?? null,
        seed.link_fetch_status ?? (seed.link_url ? 'skipped' : null),
        seed.source,
        seed.source_detail,
        now, now, now,
      )
      itemsNew++

      // Part IX: every harvest writes a snapshot — when the adapter actually
      // observed metrics (hashtag actors do; SERP hits carry none, and an
      // all-null snapshot would be noise, not data).
      if (p && (p.followerCount ?? null) !== null) {
        recordObservation({
          handle,
          observedAt: now,
          followerCount: p.followerCount ?? null,
          posts30d: p.posts30d ?? null,
          engagementProxy: p.engagementProxy ?? null,
          source: `harvest:${seed.source}#${runId}`,
        })
      }
    }
  })
  tx()

  if (unusable > 0) log(`  ${unusable} hit(s) had no extractable handle — counted found, not inserted`)
  return { itemsNew, duplicates, unusable }
}
