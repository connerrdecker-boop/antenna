/**
 * The pipeline runner (Part 2.1's spine, minus harvest — that lands in A3):
 *
 *   1. bootstrap-enrich  candidates with no bio (manual adds) get a profile
 *   2. pre-score         bio-only, claude-haiku-4-5   [needs an Anthropic key]
 *   3. enrich            pre_score >= threshold, not yet enriched
 *   4. full score        enriched + above threshold,  claude-sonnet-4-6
 *
 * Run:  npm run pipeline                    (fixture/manual provider)
 *       npm run pipeline -- --provider=actor   (the ratified Apify actor)
 *       npm run pipeline -- --limit=20
 *
 * Halts (missing key, budget cap, actor stub) are clean stops with operator
 * instructions — exit code 2. Real errors crash loudly — exit code 1.
 */
import { PRESCORE_THRESHOLD } from '@/config/limits'
import { getSqlite } from '@/db/connection'
import { loadEnvLocal, PipelineHalt } from '@/lib/env'
import { TRIAGE_NOTE_PREFIX, triageKill, triageNote } from '@/lib/triage'
import { enrichCandidate } from '@/pipeline/enrich'
import { prescoreCandidate } from '@/pipeline/prescore'
import { actorProvider } from '@/pipeline/providers/actor'
import { prefetch } from '@/pipeline/providers/prefetch'
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
  notes: string | null
}

/** A row already killed at triage carries its reason; it never re-enters. */
const triagedAlready = (notes: string | null): boolean =>
  Boolean(notes && notes.includes(TRIAGE_NOTE_PREFIX))

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
        `SELECT id, handle, bio, follower_count, link_domain, link_contents, pre_score, name, notes
         FROM candidates WHERE status = 'sourced' AND score_failed = 0 ORDER BY id LIMIT ?`,
      )
      .all(limit) as Row[]

  const tally = { triaged: 0, bootstrapped: 0, noData: 0, prescored: 0, killed: 0, enriched: 0, scored: 0, failed: 0 }

  console.log(`pipeline — provider: ${provider.name} · threshold: ${PRESCORE_THRESHOLD}`)

  // 0. ZERO-COST TRIAGE, before anything is paid for. 4b returns a HANDLE FEED
  //    — a hashtag post carries no bio and no link — so those rows take the
  //    bootstrap door below and would be ENRICHED before the cheap filter ever
  //    saw them. That is the spine inverted: we would pay the profile actor for
  //    every B2B vendor the hashtag sweep swept up, and the smoke test showed
  //    exactly who that is ("Websites for Fitness Coaches", "Coach Tools").
  //
  //    This calls nothing and costs nothing. It reads the only two fields such
  //    a row has, and a kill is RECORDED rather than deleted: the row stays
  //    `sourced` with its reason in `notes`, which is what excludes it. Clear
  //    the note and it flows again, so every kill is auditable and reversible.
  console.log('\n[0/4] triage (zero-cost: handle + name, before any paid call)')
  const triageMark = sqlite.prepare(
    `UPDATE candidates SET notes = CASE WHEN notes IS NULL OR notes = '' THEN ? ELSE notes || ' | ' || ? END,
            updated_at = ? WHERE id = ?`,
  )
  for (const c of pending()) {
    if (triagedAlready(c.notes)) continue
    const verdict = triageKill(c.handle, c.name)
    if (!verdict) continue
    const note = triageNote(verdict)
    triageMark.run(note, note, new Date().toISOString(), c.id)
    tally.triaged++
    console.log(`  KILLED @${c.handle} — ${verdict.rule}: matched "${verdict.matched}"`)
  }
  if (!tally.triaged) console.log('  nothing killed')

  // 1. Bootstrap enrichment: only rows with NOTHING to pre-score on — no bio
  //    AND no link_domain (manual adds). Harvest-sourced rows carry one or the
  //    other and go straight to the cheap filter first (the spine's whole point).
  //
  //    ONE ROUND TRIP, NOT N. prefetch() runs the provider's batch door once
  //    and hands back a provider serving those results from memory, so the
  //    per-candidate loop below is untouched — same Part V gate, same
  //    observation write per candidate — while 32 handles cost ONE actor run
  //    instead of 32. That distinction is real money and real time on a paid
  //    provider: an actor run's cost is mostly per-run overhead, not per-item,
  //    and 32 startups also take ~30x as long. A provider with no batch door
  //    (the fixture) is passed through untouched and the loop behaves exactly
  //    as it did before.
  console.log('\n[1/4] bootstrap enrich (candidates with no profile data yet)')
  const bootstrapRows = pending().filter((c) => !triagedAlready(c.notes) && !c.bio?.trim() && !c.link_domain?.trim())
  const batch = await prefetch(provider, bootstrapRows.map((c) => c.handle))
  if (batch.batched) {
    console.log(`  batched: one ${provider.name} run for ${bootstrapRows.length} handle(s) — ${batch.fetched} packet(s) returned`)
  }
  for (const c of bootstrapRows) {
    const outcome = await enrichCandidate(c, batch.provider)
    if (outcome === 'enriched') { tally.bootstrapped++; console.log(`  enriched @${c.handle}`) }
    else if (outcome === 'no_data') {
      tally.noData++
      console.log(`  no packet for @${c.handle} — the actor returned nothing for this handle (private, renamed, or gone)`)
    }
  }

  // 2. Pre-score — the first LLM stage; a missing key halts HERE, cleanly.
  //    Eligible: anything with a bio OR a link_domain (a stan.store domain
  //    alone is a real signal; the prompt handles a null bio by design).
  console.log('\n[2/4] pre-score (claude-haiku-4-5, bio-only)')
  for (const c of pending().filter((c) => !triagedAlready(c.notes) && (c.bio?.trim() || c.link_domain?.trim()) && c.pre_score === null)) {
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
  for (const c of pending().filter((c) => !triagedAlready(c.notes) && (c.pre_score ?? -1) >= PRESCORE_THRESHOLD)) {
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
      // A triaged row can never reach the expensive model. It cannot arrive
      // here through the steps above, but the guard is repeated at the query
      // rather than assumed: this is the one step that costs real money per
      // row, and it selects independently of the filters that precede it.
      `SELECT id, handle, bio, follower_count, link_domain, link_contents, pre_score, name, notes
       FROM candidates
       WHERE status = 'sourced' AND score_failed = 0 AND tier IS NULL
         AND pre_score >= ? AND last_enriched IS NOT NULL
         AND (notes IS NULL OR notes NOT LIKE '%' || ? || '%')
       ORDER BY id LIMIT ?`,
    )
    .all(PRESCORE_THRESHOLD, TRIAGE_NOTE_PREFIX, limit) as Row[]
  for (const c of toScore) {
    const packet = await provider.fetchProfile(c.handle)
    const res = await scoreCandidate(c, packet)
    if (res.ok) { tally.scored++; console.log(`  @${c.handle} -> ${res.tier} ${res.score}`) }
    else { tally.failed++; console.log(`  @${c.handle} SCORE FAILED after retry (flagged score_failed): ${res.error}`) }
  }

  console.log(
    `\ndone — triaged ${tally.triaged} · bootstrapped ${tally.bootstrapped} · prescored ${tally.prescored} (${tally.killed} killed) · ` +
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
