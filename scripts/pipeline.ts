/**
 * The pipeline runner (Part 2.1's spine, minus harvest — that lands in A3):
 *
 *   1. bootstrap-enrich  candidates with no bio (manual adds) get a profile
 *   2. pre-score         bio-only, claude-haiku-4-5   [needs ANTHROPIC_API_KEY]
 *   3. enrich            pre_score >= threshold, not yet enriched
 *   4. full score        enriched + above threshold,  claude-sonnet-4-6
 *
 * Run:  npm run pipeline                    (fixture/manual provider)
 *       npm run pipeline -- --provider=actor   (halts: A3 wiring point)
 *       npm run pipeline -- --limit=20
 *
 * Halts (missing key, budget cap, actor stub) are clean stops with operator
 * instructions — exit code 2. Real errors crash loudly — exit code 1.
 */
import { PRESCORE_THRESHOLD } from '@/config/limits'
import { getSqlite } from '@/db/connection'
import { loadEnvLocal, PipelineHalt } from '@/lib/env'
import { enrichCandidate } from '@/pipeline/enrich'
import { prescoreCandidate } from '@/pipeline/prescore'
import { actorProvider } from '@/pipeline/providers/actor'
import { fixtureProvider } from '@/pipeline/providers/fixture'
import { scoreCandidate } from '@/pipeline/score'
import type { ProfileProvider } from '@/pipeline/types'
import { runMigrations } from './migrate'

type Row = {
  id: number
  handle: string
  bio: string | null
  follower_count: number | null
  link_domain: string | null
  link_contents: string | null
  pre_score: number | null
  name: string | null
}

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.split('=').slice(1).join('=') : null
}

async function main() {
  loadEnvLocal()
  runMigrations()
  const sqlite = getSqlite()

  const providerName = arg('provider') ?? 'fixture'
  const provider: ProfileProvider =
    providerName === 'actor' ? actorProvider() : fixtureProvider()
  const limit = Number(arg('limit') ?? 200)

  const pending = (): Row[] =>
    sqlite
      .prepare(
        `SELECT id, handle, bio, follower_count, link_domain, link_contents, pre_score, name
         FROM candidates WHERE status = 'sourced' AND score_failed = 0 ORDER BY id LIMIT ?`,
      )
      .all(limit) as Row[]

  const tally = { bootstrapped: 0, noData: 0, prescored: 0, killed: 0, enriched: 0, scored: 0, failed: 0 }

  console.log(`pipeline — provider: ${provider.name} · threshold: ${PRESCORE_THRESHOLD}`)

  // 1. Bootstrap enrichment: only rows with NOTHING to pre-score on — no bio
  //    AND no link_domain (manual adds). Harvest-sourced rows carry one or the
  //    other and go straight to the cheap filter first (the spine's whole point).
  console.log('\n[1/4] bootstrap enrich (candidates with no profile data yet)')
  for (const c of pending().filter((c) => !c.bio?.trim() && !c.link_domain?.trim())) {
    const outcome = await enrichCandidate(c, provider)
    if (outcome === 'enriched') { tally.bootstrapped++; console.log(`  enriched @${c.handle}`) }
    else if (outcome === 'no_data') {
      tally.noData++
      console.log(`  no packet for @${c.handle} — drop one into ./profiles/*.json (actor provider arrives in A3)`)
    }
  }

  // 2. Pre-score — the first LLM stage; a missing key halts HERE, cleanly.
  //    Eligible: anything with a bio OR a link_domain (a stan.store domain
  //    alone is a real signal; the prompt handles a null bio by design).
  console.log('\n[2/4] pre-score (claude-haiku-4-5, bio-only)')
  for (const c of pending().filter((c) => (c.bio?.trim() || c.link_domain?.trim()) && c.pre_score === null)) {
    const res = await prescoreCandidate(c)
    if (res.ok) {
      tally.prescored++
      const gate = res.preScore >= PRESCORE_THRESHOLD ? 'passes' : 'KILLED'
      if (gate === 'KILLED') tally.killed++
      console.log(`  @${c.handle} pre_score=${res.preScore} (${gate})`)
    } else {
      tally.failed++
      console.log(`  @${c.handle} pre-score FAILED after retry: ${res.error}`)
    }
  }

  // 3. Enrich above-threshold candidates that haven't been enriched yet.
  console.log('\n[3/4] enrich (pre_score >= threshold)')
  for (const c of pending().filter((c) => (c.pre_score ?? -1) >= PRESCORE_THRESHOLD)) {
    const enrichedAlready = (sqlite
      .prepare('SELECT last_enriched FROM candidates WHERE id = ?')
      .get(c.id) as { last_enriched: string | null }).last_enriched
    if (enrichedAlready) continue
    const outcome = await enrichCandidate(c, provider)
    if (outcome === 'enriched') { tally.enriched++; console.log(`  enriched @${c.handle}`) }
    else if (outcome === 'no_data') { tally.noData++; console.log(`  no packet for @${c.handle}`) }
  }

  // 4. Full score.
  console.log('\n[4/4] full score (claude-sonnet-4-6, rubric + evidence + hook)')
  const toScore = sqlite
    .prepare(
      `SELECT id, handle, bio, follower_count, link_domain, link_contents, pre_score, name
       FROM candidates
       WHERE status = 'sourced' AND score_failed = 0 AND tier IS NULL
         AND pre_score >= ? AND last_enriched IS NOT NULL
       ORDER BY id LIMIT ?`,
    )
    .all(PRESCORE_THRESHOLD, limit) as Row[]
  for (const c of toScore) {
    const packet = await provider.fetchProfile(c.handle)
    const res = await scoreCandidate(c, packet)
    if (res.ok) { tally.scored++; console.log(`  @${c.handle} -> ${res.tier} ${res.score}`) }
    else { tally.failed++; console.log(`  @${c.handle} SCORE FAILED after retry (flagged score_failed): ${res.error}`) }
  }

  console.log(
    `\ndone — bootstrapped ${tally.bootstrapped} · prescored ${tally.prescored} (${tally.killed} killed) · ` +
    `enriched ${tally.enriched} · scored ${tally.scored} · no-data ${tally.noData} · failed ${tally.failed}`,
  )
  console.log('scored candidates are waiting in /ratify')
}

main().catch((e: unknown) => {
  if (e instanceof PipelineHalt) {
    console.error(`\n■ PIPELINE HALT\n\n${e.message}\n`)
    process.exit(2)
  }
  console.error(e)
  process.exit(1)
})
