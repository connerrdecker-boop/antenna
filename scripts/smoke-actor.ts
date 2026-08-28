/**
 * `npm run smoke:actor` — the Part 4b gate.
 *
 * "Actor names churn: the builder selects currently-maintained actors and
 * SMOKE-TESTS each with a <= $2 run before any scale run." This script is that
 * run, and it is deliberately the only path allowed through while
 * config/actors.ts is DRAFT.
 *
 * It writes NOTHING to candidates and NOTHING to observations: it is a data-
 * quality probe, not an enrichment, and Law 9 snapshots belong to real
 * enrichments. The one thing it does write is a `spend` row, because every
 * paid run writes spend — no exceptions, including experiments.
 *
 * It ends by HALTING for the operator: the actor is not ratified until a human
 * has looked at these packets and said so.
 *
 *   npm run smoke:actor                      # 3 un-enriched handles from the DB
 *   npm run smoke:actor -- --handles=a,b     # specific handles
 *   npm run smoke:actor -- --actor=owner~name
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { ACTOR_SMOKE_TEST_CAP, CAPS } from '@/config/limits'
import { DEFAULT_PROFILE_ACTOR, PROFILE_ACTOR_CANDIDATES, ACTOR_SELECTION_STATUS } from '@/config/actors'
import { getSqlite } from '@/db/connection'
import { loadEnvLocal, PipelineHalt } from '@/lib/env'
import { spentIn, spentTotal } from '@/pipeline/lib/budget'
import { actorProvider, estimateActorRunUsd } from '@/pipeline/providers/actor'
import type { MapReport } from '@/pipeline/providers/actorMap'
import type { ProfilePacket } from '@/pipeline/types'

loadEnvLocal()

/** Part 4b says a smoke test is a couple of profiles, not a batch. */
const MAX_SMOKE_HANDLES = 3
const RAW_DUMP = 'profiles/_smoke-raw.json'

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
}

function pickHandles(): string[] {
  const explicit = arg('handles')
  if (explicit) {
    return explicit.split(',').map((s) => s.trim().replace(/^@/, '').toLowerCase()).filter(Boolean).slice(0, MAX_SMOKE_HANDLES)
  }
  const rows = getSqlite()
    .prepare(
      `SELECT handle FROM candidates
        WHERE bio IS NULL AND last_enriched IS NULL AND status = 'sourced'
        ORDER BY id LIMIT ?`,
    )
    .all(MAX_SMOKE_HANDLES) as { handle: string }[]
  return rows.map((r) => r.handle)
}

const usd = (n: number) => `$${n.toFixed(4)}`
const line = (s = '') => console.log(s)

function describePacket(p: ProfilePacket): void {
  const bio = (p.bio ?? '').trim()
  line(`  ┌─ @${p.handle}${p.name ? `  (${p.name})` : ''}`)
  line(`  │  private:    ${p.isPrivate === null || p.isPrivate === undefined ? 'unknown' : p.isPrivate ? 'YES — honest X, no paid score' : 'no'}`)
  line(`  │  followers:  ${p.followerCount ? p.followerCount.toLocaleString() : '— (none reported)'}`)
  line(`  │  bio:        ${bio ? `${bio.length} chars` : '— EMPTY'}`)
  for (const l of bio.split('\n').filter(Boolean)) line(`  │    ${l}`)
  line(`  │  link:       ${p.linkUrl ?? '— none'}`)
  line(`  │  captions:   ${p.captions?.length ?? 0}`)
  for (const c of (p.captions ?? []).slice(0, 2)) {
    line(`  │    "${c.replace(/\s+/g, ' ').slice(0, 110)}${c.length > 110 ? '…' : ''}"`)
  }
  line(`  │  posts30d:   ${p.posts30d ?? '— (no timestamps in output)'}`)
  line(`  │  formatMix:  ${p.formatMix ? JSON.stringify(p.formatMix) : '— none'}`)
  line(`  │  engagement: ${p.engagementProxy ?? '— none'}`)
  line(`  │  tags:       ${p.tags?.length ? p.tags.join(', ') : '— none'}`)
  line('  └─')
}

function describeMapping(reports: MapReport[]): void {
  if (!reports.length) return
  const byField = new Map<string, Set<string>>()
  for (const r of reports) {
    for (const f of r.fields) {
      if (!byField.has(f.field)) byField.set(f.field, new Set())
      byField.get(f.field)!.add(f.via ?? 'NOT FOUND')
    }
  }
  line('  FIELD MAPPING — which actor key each packet field was read from:')
  for (const [field, vias] of byField) {
    const v = [...vias].join(', ')
    line(`    ${field.padEnd(15)} ${v === 'NOT FOUND' ? 'NOT FOUND — mapper needs an alias for this actor' : v}`)
  }
}

async function main(): Promise<void> {
  const handles = pickHandles()
  const actorId = arg('actor')
  const candidate = actorId
    ? PROFILE_ACTOR_CANDIDATES.find((c) => c.id === actorId) ?? {
        id: actorId,
        note: 'operator-specified on the command line',
        // An unknown actor gets the conventional username input; if it wants
        // something else the run fails visibly rather than half-working.
        buildInput: (hs: readonly string[]) => ({ usernames: [...hs] }),
      }
    : DEFAULT_PROFILE_ACTOR

  if (!handles.length) {
    throw new PipelineHalt(
      'No handles to smoke-test. Either add candidates via /add, or pass them: ' +
      'npm run smoke:actor -- --handles=one,two',
    )
  }

  line('\n══ PART 4b ACTOR SMOKE TEST ══\n')
  line(`  selection status: ${ACTOR_SELECTION_STATUS}`)
  line(`  actor:            ${candidate.id}`)
  line(`                    ${candidate.note}`)
  line(`  handles (${handles.length}):      ${handles.map((h) => `@${h}`).join(', ')}`)
  line(`  hard cap:         ${usd(ACTOR_SMOKE_TEST_CAP)} (ACTOR_SMOKE_TEST_CAP, sent as maxTotalChargeUsd)`)
  line(`  pre-run estimate: ${usd(estimateActorRunUsd(handles.length))}`)
  line(`  actors spent:     ${usd(spentIn('actors'))} of ${usd(CAPS.actors)} · total ${usd(spentTotal())} of ${usd(CAPS.total)}`)
  line('')
  line('  writes: one spend row. NOT candidates, NOT observations — this is a probe.')
  line('')

  let rawItems: Record<string, unknown>[] = []
  let reports: MapReport[] = []

  const provider = actorProvider({
    smokeTest: true,
    candidate,
    runRef: 'smoke:actor',
    onItems: (items, rs) => { rawItems = items; reports = rs },
    onWait: (status, ms) => line(`  … ${status} (${Math.round(ms / 1000)}s)`),
  })

  const before = spentIn('actors')
  const packets = await provider.fetchProfiles!(handles)
  const charged = spentIn('actors') - before

  line('')
  line(`  run charged ${usd(charged)} (Apify's figure, recorded to spend)`)
  line(`  returned ${packets.length} packet(s) for ${handles.length} handle(s)`)
  line('')

  const missed = handles.filter((h) => !packets.some((p) => p.handle === h))
  if (missed.length) line(`  NO DATA for: ${missed.map((h) => `@${h}`).join(', ')}\n`)

  for (const p of packets) describePacket(p)
  line('')
  describeMapping(reports)

  mkdirSync('profiles', { recursive: true })
  writeFileSync(RAW_DUMP, JSON.stringify(rawItems, null, 2))
  line('')
  line(`  raw actor output saved to ${RAW_DUMP} (gitignored) — inspect it if a field reads NOT FOUND.`)

  if (charged > ACTOR_SMOKE_TEST_CAP) {
    throw new PipelineHalt(
      `SMOKE TEST OVERRAN ITS CAP: charged ${usd(charged)} against a ${usd(ACTOR_SMOKE_TEST_CAP)} ceiling. ` +
      'The spend is recorded. Do not scale this actor until the overrun is understood.',
    )
  }

  line('')
  line('══ HALT — OPERATOR REVIEW REQUIRED ══')
  line('')
  line('  Part 4b: results are shown BEFORE any scale run. This actor is NOT ratified.')
  line('  config/actors.ts still reads DRAFT, and every scale path refuses while it does.')
  line('')
  line('  If the packets above are good: ratify the selection, then enrich the batch.')
  line('  If a field reads NOT FOUND or a bio is empty: the actor or the mapper is wrong —')
  line('  try another candidate with --actor=, do not scale.')
  line('')
}

main().catch((e: unknown) => {
  if (e instanceof PipelineHalt) {
    console.error(`\n■ HALT\n\n${e.message}\n`)
    process.exit(2)
  }
  console.error(e)
  process.exit(1)
})
