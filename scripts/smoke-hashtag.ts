/**
 * `npm run smoke:hashtag` — the Part 4b gate for the 4b channel's own actor.
 *
 * The same sequence the profile scraper went through on 2026-08-29: pick a
 * maintained hashtag-scraper-class actor, run it once under the $2 ceiling,
 * put the packets in front of the operator, and HALT. Ratification is a human
 * looking at real output, never an id typed into a config file.
 *
 * Writes ONE spend row. Not candidates, not observations — this is a probe.
 *
 *   npm run smoke:hashtag
 *   npm run smoke:hashtag -- --tag=#onlinecoach --limit=10
 *   npm run smoke:hashtag -- --actor=owner~name
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import {
  ACTOR_SMOKE_TEST_CAP, CAPS, HARVEST_COST,
} from '@/config/limits'
import {
  DEFAULT_HASHTAG_ACTOR, HASHTAG_ACTOR_CANDIDATES, HASHTAG_ACTOR_SELECTION_STATUS,
  type HashtagActorCandidate,
} from '@/config/actors'
import { loadEnvLocal, PipelineHalt } from '@/lib/env'
import { spentIn, spentTotal, recordSpend } from '@/pipeline/lib/budget'
import { apifyActorProvider } from '@/pipeline/harvest/providers'
import { runMigrations } from './migrate'

const RAW_DUMP = 'profiles/_smoke_hashtag_raw.json'
const usd = (n: number) => `$${n.toFixed(4)}`
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? null

async function main(): Promise<void> {
  loadEnvLocal()
  runMigrations()

  const tag = arg('tag') ?? '#onlinefitnesscoach'
  const limit = Number(arg('limit') ?? 15)
  const actorId = arg('actor')
  const candidate: HashtagActorCandidate = actorId
    ? HASHTAG_ACTOR_CANDIDATES.find((c) => c.id === actorId) ?? {
        id: actorId,
        note: 'operator-specified on the command line',
        buildInput: (tags, l) => ({ hashtags: tags.map((t) => t.replace(/^#/, '')), resultsLimit: l }),
      }
    : DEFAULT_HASHTAG_ACTOR

  const estimate = Math.max(0.05, limit * HARVEST_COST.actorPerItem)

  console.log('\n══ PART 4b HASHTAG ACTOR SMOKE TEST ══\n')
  console.log(`  selection status: ${HASHTAG_ACTOR_SELECTION_STATUS}`)
  console.log(`  actor:            ${candidate.id}`)
  console.log(`                    ${candidate.note}`)
  console.log(`  tag:              ${tag}  (limit ${limit})`)
  console.log(`  hard cap:         ${usd(ACTOR_SMOKE_TEST_CAP)} (ACTOR_SMOKE_TEST_CAP, sent as maxTotalChargeUsd)`)
  console.log(`  pre-run estimate: ${usd(estimate)}`)
  console.log(`  actors spent:     ${usd(spentIn('actors'))} of $${CAPS.actors.toFixed(2)} · total ${usd(spentTotal())} of $${CAPS.total.toFixed(2)}`)
  console.log('')
  console.log('  writes: one spend row. NOT candidates, NOT observations — this is a probe.')
  console.log('')

  let rawItems: Record<string, unknown>[] = []
  let charged = 0

  const provider = apifyActorProvider({
    smokeTest: true,
    candidate,
    onItems: (items) => { rawItems = items },
    onSpend: (u) => { charged = u },
  })

  const packets = await provider.hashtagProfiles([tag], limit)

  // The probe records its own spend: runHarvest is not in this path, so
  // nothing else would put it on the ledger, and an unrecorded charge is a
  // ledger that disagrees with the bill.
  if (charged > 0) {
    recordSpend('actors', charged, 'smoke:hashtag', `${candidate.id} · ${tag} · limit ${limit}`)
  }

  console.log(`  run charged ${usd(charged)} (Apify's own figure, recorded to spend)`)
  console.log(`  raw items returned: ${rawItems.length}`)
  console.log(`  distinct owner handles: ${packets.length}`)
  console.log('')

  // ── PACKET QUALITY, the thing the operator is actually ratifying ────────
  const FIELDS = ['ownerUsername', 'ownerFullName', 'caption', 'likesCount', 'commentsCount', 'url', 'timestamp'] as const
  console.log('  FIELD COVERAGE across raw items:')
  for (const f of FIELDS) {
    const present = rawItems.filter((i) => i[f] !== undefined && i[f] !== null && i[f] !== '').length
    console.log(`    ${f.padEnd(16)} ${String(present).padStart(3)}/${rawItems.length}${present === 0 ? '   NOT FOUND' : ''}`)
  }
  console.log('')
  console.log('  KEYS the actor actually returned (first item):')
  console.log(`    ${rawItems.length ? Object.keys(rawItems[0]).join(', ') : '(no items)'}`)
  console.log('')
  console.log('  HANDLES (what 4b delivers to the pipeline):')
  for (const p of packets.slice(0, 20)) {
    console.log(`    @${p.username}${p.fullName ? `  (${p.fullName})` : ''}`)
  }
  if (packets.length > 20) console.log(`    … and ${packets.length - 20} more`)
  console.log('')

  mkdirSync('profiles', { recursive: true })
  writeFileSync(RAW_DUMP, JSON.stringify(rawItems.slice(0, 5), null, 2))
  console.log(`  first 5 raw items saved to ${RAW_DUMP} (gitignored) — inspect if a field reads NOT FOUND.`)

  if (charged > ACTOR_SMOKE_TEST_CAP) {
    throw new PipelineHalt(
      `SMOKE TEST OVERRAN ITS CAP: charged ${usd(charged)} against a ${usd(ACTOR_SMOKE_TEST_CAP)} ceiling. ` +
      'The spend is recorded. Do not scale this actor until the overrun is understood.',
    )
  }

  console.log('')
  console.log('══ HALT — OPERATOR REVIEW REQUIRED ══')
  console.log('')
  console.log('  Part 4b: results are shown BEFORE any scale run. This actor is NOT ratified.')
  console.log('  config/actors.ts still reads DRAFT for the hashtag selection, and every')
  console.log('  hashtag scale path refuses while it does.')
  console.log('')
  console.log('  A hashtag post carries NO bio and NO follower count. If the handles above')
  console.log('  look like real coaches, 4b is a HANDLE FEED and each one still needs a')
  console.log('  profile-actor enrich before it can be scored — a cost the wave projection')
  console.log('  must carry explicitly rather than assume away.')
  console.log('')
}

main().catch((e: unknown) => {
  if (e instanceof PipelineHalt) { console.error(`\n■ ${e.message}\n`); process.exit(2) }
  console.error(e)
  process.exit(1)
})
