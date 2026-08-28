/**
 * PART 4b / PART V — the actor-backed profile provider, WIRED.
 *
 * Two doors, and the difference between them is the whole of Part 4b's
 * discipline:
 *
 *   smoke test  — allowed while config/actors.ts is DRAFT, capped at
 *                 ACTOR_SMOKE_TEST_CAP ($2), exists to show the operator what
 *                 the packets actually look like before anything scales.
 *   scale run   — refuses while the selection is DRAFT. An actor becomes
 *                 ratified by passing its smoke test in front of the operator,
 *                 never by being typed into a config file.
 *
 * Both go through ensureBudget() before the call and recordSpend() with
 * Apify's own usage figure after it.
 */
import {
  ACTOR_RUN_BOUNDS, DEFAULT_PROFILE_ACTOR, actorSelectionIsDraft,
  type ActorCandidate,
} from '@/config/actors'
import { ACTOR_SMOKE_TEST_CAP, HARVEST_COST } from '@/config/limits'
import { PipelineHalt } from '@/lib/env'
import { ensureBudget, recordSpend } from '@/pipeline/lib/budget'
import type { ProfilePacket, ProfileProvider } from '../types'
import { mapActorItem, type MapReport } from './actorMap'
import { runActor } from './apify'

export type ActorProviderOpts = {
  /** The one door open while the selection is DRAFT. Capped at $2. */
  smokeTest?: boolean
  /** Which candidate to run. Defaults to the first in config/actors.ts. */
  candidate?: ActorCandidate
  /** Written into every spend row this provider creates (Law 4). */
  runRef?: string
  /** Called with the raw items + mapping report — the smoke test prints these. */
  onItems?: (items: Record<string, unknown>[], reports: MapReport[]) => void
  onWait?: (status: string, elapsedMs: number) => void
}

export function requireApifyToken(): string {
  const token = process.env.APIFY_TOKEN
  if (!token || !token.trim()) {
    throw new PipelineHalt(
      [
        'APIFY_TOKEN is not set — the actor-backed profile provider cannot run.',
        '',
        'To fix: create .env.local in the repo root (it is gitignored) containing:',
        '',
        '  APIFY_TOKEN=apify_api_...',
        '',
        'Get one from apify.com → Settings → Integrations → Personal API tokens',
        '(small free credit, then ~$1-3/1K profiles against the $100 actors cap).',
        'Nothing was charged. Fixture runs remain available: --provider=fixture.',
      ].join('\n'),
    )
  }
  return token.trim()
}

/**
 * Pre-call estimate for the budget gate. Small batches are dominated by
 * per-run overhead, so the floor matters more than the rate; the number
 * written to `spend` afterwards is Apify's actual, not this.
 */
export function estimateActorRunUsd(handleCount: number): number {
  return Number(Math.max(0.05, HARVEST_COST.actorPerItem * handleCount).toFixed(4))
}

export function actorProvider(opts: ActorProviderOpts = {}): ProfileProvider {
  const candidate = opts.candidate ?? DEFAULT_PROFILE_ACTOR
  const runRef = opts.runRef ?? 'actor:profiles'

  async function fetchMany(handles: readonly string[]): Promise<ProfilePacket[]> {
    if (!handles.length) return []

    if (actorSelectionIsDraft() && !opts.smokeTest) {
      throw new PipelineHalt(
        'The actor selection (config/actors.ts) is DRAFT — no actor has passed its smoke test yet, so a ' +
        'SCALE run refuses to spend (Part 4b: smoke-test with a <= $2 run and show the operator results ' +
        'BEFORE any scale run).\n\nRun `npm run smoke:actor` first. Nothing was charged.',
      )
    }

    const token = requireApifyToken()
    const cap = opts.smokeTest ? ACTOR_SMOKE_TEST_CAP : estimateActorRunUsd(handles.length) * 4
    const estimate = opts.smokeTest
      ? Math.min(ACTOR_SMOKE_TEST_CAP, estimateActorRunUsd(handles.length))
      : estimateActorRunUsd(handles.length)

    // Law 6: the gate runs BEFORE any paid work, and throws rather than
    // returning a boolean a caller could forget to read.
    ensureBudget('actors', estimate)

    const result = await runActor({
      actorId: candidate.id,
      input: candidate.buildInput(handles),
      token,
      maxChargeUsd: cap,
      timeoutSecs: ACTOR_RUN_BOUNDS.timeoutSecs,
      memoryMbytes: ACTOR_RUN_BOUNDS.memoryMbytes,
      onWait: opts.onWait,
    })

    // Spend is recorded even when the run FAILED: a failed Apify run still
    // burns compute and still appears on the bill. Recording only successes
    // would make the ledger disagree with reality, which is the one thing the
    // ledger may never do.
    if (result.usageUsd > 0) {
      recordSpend(
        'actors', result.usageUsd, runRef,
        `${candidate.id} · ${handles.length} handles · ${result.status} · run ${result.runId}`,
      )
    }

    const mapped = result.items.map((item) => mapActorItem(item))
    opts.onItems?.(result.items, mapped.map((m) => m.report))

    if (result.status !== 'SUCCEEDED' && !mapped.length) {
      throw new PipelineHalt(
        `Apify run ${result.runId} finished ${result.status} with no items. ` +
        `Charged $${result.usageUsd.toFixed(4)} (recorded). Check the run log at ` +
        `apify.com/view/runs/${result.runId}.`,
      )
    }

    return mapped.map((m) => m.packet).filter((p): p is ProfilePacket => p !== null)
  }

  return {
    name: `actor:${candidate.id}`,
    async fetchProfile(handle: string): Promise<ProfilePacket | null> {
      const [packet] = await fetchMany([handle])
      return packet ?? null
    },
    fetchProfiles: fetchMany,
  }
}
