/**
 * `npm run calibrate` — the A2 CALIBRATION run.
 *
 * THE RATIFIED DEVIATION (this batch only, operator-authorised):
 *   Normally the pre-score is a KILL GATE: anything below PRESCORE_THRESHOLD
 *   never reaches the capable model (pipeline.ts step 4 filters on it), which
 *   is the whole economic point of the spine.
 *
 *   For calibration that gate is BYPASSED. The pre-score still runs and its
 *   verdict and kill_reasons are recorded as evidence — but every candidate is
 *   full-scored regardless of it. The golden set needs a complete judgment on
 *   each profile for the operator's ratify pass to disagree with, and a killed
 *   candidate yields nothing to disagree with. The size band in particular is
 *   under review, and the band cannot be re-cut from a population the gate
 *   already truncated.
 *
 * WHAT THIS SCRIPT DELIBERATELY DOES NOT DO:
 *   - It does not touch PRESCORE_THRESHOLD. The constant is canon and the gate
 *     stays armed for harvest; the bypass lives here, in a script that only
 *     the operator runs, and nowhere else.
 *   - It does not add a `score_context` COLUMN. Part III's column list is
 *     canon and `check.ts` allows exactly two extras beyond it, each ratified.
 *     A third is a ratification decision, not a side effect of a scoring run,
 *     so the marker is written to `notes` (a Part III column) and to the run
 *     artifact.
 *
 * The pre-score's kill_reasons are captured BEFORE the full score runs,
 * because the full scorer overwrites `evidence` with its own rubric lines.
 * Without this the deviation's whole point — keeping the killed verdict as
 * evidence — would be silently destroyed by the next step.
 *
 *   npm run calibrate -- --phase=prescore   # stage 1 only
 *   npm run calibrate -- --phase=refetch    # recover packets (one actor run)
 *   npm run calibrate -- --phase=score      # stage 2 only (the bypass)
 *   npm run calibrate -- --phase=both       # default
 *   npm run calibrate -- --dry-run          # select + report, spend nothing
 *
 * WHY A REFETCH PHASE EXISTS AT ALL. Part III persists no captions column, so
 * score.ts re-fetches the packet from the provider at score time. In a rebuilt
 * container ./profiles is gone (gitignored, Law 5) and the snapshot cannot
 * carry captions, so the scorer's stated INPUT — "last ~6 captions, link page
 * text, tags" — arrives empty and `alive_30d` (a GATE) has nothing to read.
 * Scoring on that input does not produce a weak judgment; it produces a
 * uniform X at score <= 39 that teaches the golden set nothing. So the packets
 * are recovered ONCE into a cache the score phase reads, which also means
 * re-scoring never re-charges the actor.
 *
 * The refetch takes the ordinary SCALE door. It went through the smoke door on
 * the run that produced this batch, because config/actors.ts still read DRAFT
 * then and ratifying an actor is the operator's decision rather than a side
 * effect of needing packets. That selection is ratified now (with this run
 * recorded in its evidence), so the scale door is the honest path and the
 * smoke cap no longer has to stand in for a ratification that had not happened.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { CAPS, PRESCORE_THRESHOLD } from '@/config/limits'
import { getSqlite } from '@/db/connection'
import { loadEnvLocal, PipelineHalt } from '@/lib/env'
import { CALIBRATION_ARTIFACT_PATH, CALIBRATION_PACKETS_PATH } from '@/lib/stateExport'
import { spentIn } from '@/pipeline/lib/budget'
import { prescoreCandidate } from '@/pipeline/prescore'
import { scoreCandidate } from '@/pipeline/score'
import { actorProvider, estimateActorRunUsd } from '@/pipeline/providers/actor'
import { fixtureProvider } from '@/pipeline/providers/fixture'
import type { ProfilePacket, ProfileProvider } from '@/pipeline/types'
import { runMigrations } from './migrate'

export const SCORE_CONTEXT = 'calibration'
export const ARTIFACT_PATH = CALIBRATION_ARTIFACT_PATH
/**
 * Recovered packets. Person-linked (captions, bios), so it lives under the
 * gitignored state/calibration/ with the artifact rather than in profiles/:
 * fixtureProvider's coerce() drops any packet whose follower_count is not a
 * number, and a null follower count is UNKNOWN, not zero — round-tripping
 * through it would silently lose exactly those candidates.
 */
export const PACKETS_PATH = CALIBRATION_PACKETS_PATH

type Row = {
  id: number
  handle: string
  name: string | null
  bio: string | null
  follower_count: number | null
  link_domain: string | null
  link_contents: string | null
  pre_score: number | null
}

type Entry = {
  handle: string
  name: string | null
  follower_count: number | null
  /** stage 1 */
  pre_score: number | null
  kill_reasons: string[]
  /** what the gate WOULD have done, recorded rather than obeyed */
  prescore_verdict: 'pass' | 'kill' | 'failed' | null
  bypassed: boolean
  /** stage 2 — what the RULES arithmetic stored */
  tier: string | null
  score: number | null
  /**
   * What the MODEL itself claimed, before computeScoreAndTier() overrode it.
   * Ratified after the A2 run, where the two disagreed on 24 of 32 and 6 of the
   * 7 B tiers existed only because of the override. Recording only the winner
   * makes that invisible.
   */
  claimed_tier: string | null
  claimed_score: number | null
  arithmetic_override: boolean
  reason: string | null
  score_failed: boolean
  /** what actually reached the model, so a weak judgment is legible as weak */
  inputs: { captions: number; tags: number; link_page_text: boolean; posts_30d: number | null } | null
}

type Artifact = {
  schema: number
  score_context: string
  deviation: string
  prescore_threshold: number
  provider: string | null
  started_at: string
  updated_at: string
  entries: Entry[]
}

const arg = (n: string): string | null =>
  process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? null
const flag = (n: string): boolean => process.argv.includes(`--${n}`)

function loadArtifact(): Artifact {
  if (existsSync(ARTIFACT_PATH)) return JSON.parse(readFileSync(ARTIFACT_PATH, 'utf8')) as Artifact
  return {
    schema: 1,
    score_context: SCORE_CONTEXT,
    deviation:
      'prescore kill gate BYPASSED for this batch: pre-score ran and its verdict + kill_reasons ' +
      'are recorded as evidence, but every candidate was full-scored regardless. ' +
      'Normal gating remains armed for harvest (PRESCORE_THRESHOLD untouched).',
    prescore_threshold: PRESCORE_THRESHOLD,
    provider: null,
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    entries: [],
  }
}

function saveArtifact(a: Artifact): void {
  a.updated_at = new Date().toISOString()
  mkdirSync('state/calibration', { recursive: true })
  writeFileSync(ARTIFACT_PATH, JSON.stringify(a, null, 2) + '\n')
}

const upsert = (a: Artifact, handle: string): Entry => {
  let e = a.entries.find((x) => x.handle === handle)
  if (!e) {
    e = {
      handle, name: null, follower_count: null,
      pre_score: null, kill_reasons: [], prescore_verdict: null, bypassed: false,
      tier: null, score: null, claimed_tier: null, claimed_score: null,
      arithmetic_override: false, reason: null, score_failed: false, inputs: null,
    }
    a.entries.push(e)
  }
  return e
}

/**
 * THE BATCH: enriched, never pre-scored, never scored. Exactly the 32 handles
 * added for calibration. Deliberately NOT filtered on pre_score — that filter
 * is the gate this run is authorised to bypass.
 */
function batch(): Row[] {
  return getSqlite()
    .prepare(
      `SELECT id, handle, name, bio, follower_count, link_domain, link_contents, pre_score
         FROM candidates
        WHERE status = 'sourced' AND score_failed = 0 AND tier IS NULL
          AND last_enriched IS NOT NULL
        ORDER BY handle`,
    )
    .all() as Row[]
}

/** The pre-score writes kill reasons into `evidence`; read them back before the full scorer overwrites it. */
function killReasonsOf(id: number): string[] {
  const row = getSqlite().prepare('SELECT evidence FROM candidates WHERE id = ?').get(id) as
    | { evidence: string | null }
    | undefined
  if (!row?.evidence) return []
  try {
    const lines = JSON.parse(row.evidence) as unknown
    if (!Array.isArray(lines)) return []
    return lines
      .map(String)
      .filter((l) => l.startsWith('PRESCORE kill: '))
      .map((l) => l.slice('PRESCORE kill: '.length))
  } catch {
    return []
  }
}

const llmSpend = (): number =>
  (getSqlite()
    .prepare("SELECT COALESCE(SUM(amount), 0) s FROM spend WHERE category = 'llm'")
    .get() as { s: number }).s

/** One-line reason: the model's own top rubric line, not a summary I invent. */
function oneLineReason(id: number): string | null {
  const row = getSqlite().prepare('SELECT evidence FROM candidates WHERE id = ?').get(id) as
    | { evidence: string | null }
    | undefined
  if (!row?.evidence) return null
  try {
    const lines = (JSON.parse(row.evidence) as unknown[]).map(String)
    const failedGate = lines.find((l) => l.startsWith('GATE ') && l.includes(': FAIL'))
    if (failedGate) return failedGate.replace(/^GATE /, 'gate ').replace(': FAIL —', ' failed:')
    const dims = lines
      .filter((l) => l.startsWith('DIM '))
      .map((l) => {
        const m = l.match(/^DIM (\w+) (\d+)\/(\d+) — (.*)$/)
        return m ? { key: m[1], pts: Number(m[2]), body: m[4] } : null
      })
      .filter((d): d is { key: string; pts: number; body: string } => d !== null)
    const top = dims.sort((a, b) => b.pts - a.pts)[0]
    return top ? `${top.key} ${top.pts}pts — ${top.body}` : lines[0] ?? null
  } catch {
    return null
  }
}

async function main() {
  loadEnvLocal()
  runMigrations()
  const sqlite = getSqlite()

  const phase = arg('phase') ?? 'both'
  if (!['prescore', 'refetch', 'score', 'both'].includes(phase)) {
    throw new PipelineHalt(`--phase must be prescore | refetch | score | both (got ${phase})`)
  }
  const providerName = arg('provider') ?? 'fixture'
  const provider: ProfileProvider = providerName === 'actor' ? actorProvider() : fixtureProvider()

  const rows = batch()
  const artifact = loadArtifact()
  artifact.provider = providerName

  const spendBefore = llmSpend()
  console.log(
    `\nCALIBRATION — score_context=${SCORE_CONTEXT} · phase=${phase} · provider=${provider.name}\n` +
    `  batch: ${rows.length} candidates · prescore threshold ${PRESCORE_THRESHOLD} (RECORDED, NOT ENFORCED)\n` +
    `  llm spend so far: $${spendBefore.toFixed(4)}\n`,
  )

  if (flag('dry-run')) {
    for (const c of rows) console.log(`  would calibrate @${c.handle}`)
    console.log(`\nDRY RUN — nothing spent, nothing written.\n`)
    return
  }

  // ── stage 1: pre-score. Verdict recorded as evidence, never obeyed. ──────
  if (phase === 'prescore' || phase === 'both') {
    console.log(`[1/2] pre-score (claude-haiku-4-5, bio-only) — verdict recorded, kill NOT applied`)
    for (const c of rows) {
      const e = upsert(artifact, c.handle)
      e.name = c.name
      e.follower_count = c.follower_count
      if (e.pre_score !== null) { console.log(`  @${c.handle} pre_score=${e.pre_score} (already recorded)`); continue }

      const res = await prescoreCandidate(c)
      if (res.ok) {
        e.pre_score = res.preScore
        e.kill_reasons = killReasonsOf(c.id)
        e.prescore_verdict = res.preScore >= PRESCORE_THRESHOLD ? 'pass' : 'kill'
        e.bypassed = e.prescore_verdict === 'kill'
        console.log(
          `  @${c.handle.padEnd(21)} pre_score=${String(res.preScore).padStart(3)}  ` +
          `${e.prescore_verdict === 'kill' ? 'WOULD KILL (bypassed)' : 'would pass'}` +
          `${e.kill_reasons.length ? ` — ${e.kill_reasons.join('; ')}` : ''}`,
        )
      } else {
        e.prescore_verdict = 'failed'
        console.log(`  @${c.handle} pre-score FAILED after retry: ${res.error}`)
      }
      saveArtifact(artifact)
    }
  }

  // ── refetch: recover the packets the rebuilt container lost ─────────────
  if (phase === 'refetch') {
    const handles = rows.map((r) => r.handle)
    const spentBefore = spentIn('actors')
    console.log(
      `[refetch] apify profile actor · ${handles.length} handles · scale door (selection ratified)\n` +
      `  pre-run estimate $${estimateActorRunUsd(handles.length).toFixed(4)}\n` +
      `  actors spent $${spentBefore.toFixed(4)} of $${CAPS.actors.toFixed(2)}\n`,
    )

    const actor = actorProvider({
      runRef: 'calibrate:refetch',
      onWait: (status, ms) => console.log(`  … ${status} (${Math.round(ms / 1000)}s)`),
    })
    const packets = await actor.fetchProfiles!(handles)
    const charged = spentIn('actors') - spentBefore

    mkdirSync('state/calibration', { recursive: true })
    writeFileSync(PACKETS_PATH, JSON.stringify(packets, null, 2) + '\n')

    const missed = handles.filter((h) => !packets.some((p) => p.handle.toLowerCase() === h.toLowerCase()))
    const withCaptions = packets.filter((p) => (p.captions?.length ?? 0) > 0).length
    console.log(
      `\n  charged $${charged.toFixed(4)} · ${packets.length}/${handles.length} packets · ` +
      `${withCaptions} with captions · ${packets.filter((p) => p.isPrivate).length} private\n` +
      (missed.length ? `  NO DATA for: ${missed.map((h) => `@${h}`).join(', ')}\n` : '') +
      `  cached to ${PACKETS_PATH} — re-scoring will not re-charge the actor\n`,
    )
    saveArtifact(artifact)
    return
  }

  // ── stage 2: full score, gate bypassed ──────────────────────────────────
  if (phase === 'score' || phase === 'both') {
    // Recovered packets win over the provider: they are what the actor
    // actually returned for THIS batch, and reading them costs nothing.
    const cached = new Map<string, ProfilePacket>()
    if (existsSync(PACKETS_PATH)) {
      for (const p of JSON.parse(readFileSync(PACKETS_PATH, 'utf8')) as ProfilePacket[]) {
        cached.set(p.handle.toLowerCase(), p)
      }
    }
    console.log(
      `\n[2/2] full score (claude-sonnet-4-6) — ALL ${rows.length}, prescore gate bypassed\n` +
      `  packets: ${cached.size} recovered from ${PACKETS_PATH}${cached.size ? '' : ' (NONE — inputs will be bio + followers only)'}`,
    )
    for (const c of rows) {
      const e = upsert(artifact, c.handle)
      if (e.tier !== null) { console.log(`  @${c.handle} -> ${e.tier} ${e.score} (already scored)`); continue }

      const packet: ProfilePacket | null =
        cached.get(c.handle.toLowerCase()) ?? (await provider.fetchProfile(c.handle))
      const obs = sqlite
        .prepare('SELECT posts_30d FROM observations WHERE handle = ? ORDER BY observed_at DESC LIMIT 1')
        .get(c.handle) as { posts_30d: number | null } | undefined
      e.inputs = {
        captions: packet?.captions?.length ?? 0,
        tags: packet?.tags?.length ?? 0,
        link_page_text: Boolean(c.link_contents),
        posts_30d: obs?.posts_30d ?? null,
      }

      const res = await scoreCandidate(c, packet)
      if (res.ok) {
        e.tier = res.tier
        e.score = res.score
        e.claimed_tier = res.claimed?.tier ?? null
        e.claimed_score = res.claimed?.score ?? null
        e.arithmetic_override =
          res.claimed !== null && (res.claimed.tier !== res.tier || res.claimed.score !== res.score)
        const drift = e.arithmetic_override
          ? `  [model said ${e.claimed_tier} ${e.claimed_score}]`
          : ''
        e.reason = oneLineReason(c.id)
        console.log(`  @${c.handle.padEnd(21)} -> ${res.tier} ${String(res.score).padStart(3)}${drift}  ${e.reason ?? ''}`)
      } else {
        e.score_failed = true
        e.reason = `SCORE FAILED after retry: ${res.error}`
        console.log(`  @${c.handle} SCORE FAILED (flagged score_failed): ${res.error}`)
      }
      saveArtifact(artifact)
    }

    // The durable marker, in a Part III column rather than a new one.
    const mark = sqlite.prepare(
      `UPDATE candidates
          SET notes = CASE
                WHEN notes IS NULL OR notes = '' THEN ?
                WHEN notes LIKE '%score_context=' || ? || '%' THEN notes
                ELSE notes || ' | ' || ?
              END,
              updated_at = ?
        WHERE id = ?`,
    )
    const marker = `score_context=${SCORE_CONTEXT}`
    const at = new Date().toISOString()
    for (const c of rows) mark.run(marker, SCORE_CONTEXT, marker, at, c.id)
  }

  saveArtifact(artifact)

  const spent = llmSpend() - spendBefore
  const done = artifact.entries.filter((e) => e.tier !== null)
  const byTier = ['A', 'B', 'C', 'X'].map((t) => `${t}:${done.filter((e) => e.tier === t).length}`).join(' · ')
  const wouldKill = artifact.entries.filter((e) => e.prescore_verdict === 'kill')
  const overridden = artifact.entries.filter((e) => e.arithmetic_override)

  console.log(
    `\ndone — ${done.length} scored (${byTier}) · ${wouldKill.length} would have been killed by the gate\n` +
    `${overridden.length} of ${done.length} had the RULES arithmetic override the model's own claim\n` +
    `llm spend this run: $${spent.toFixed(4)} · llm total: $${llmSpend().toFixed(4)}\n` +
    `artifact: ${ARTIFACT_PATH}\n`,
  )
}

main().catch((e: unknown) => {
  if (e instanceof PipelineHalt) {
    console.error(`\n■ CALIBRATION HALT\n\n${e.message}\n`)
    process.exit(2)
  }
  console.error(e)
  process.exit(1)
})
