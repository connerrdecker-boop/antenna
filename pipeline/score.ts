/**
 * PART VI, stage 2 — the full score. Capable model, rubric, evidence, hook.
 *
 * Prompt: prompts/score_v1.md, verbatim canon, with {FEW_SHOT_BLOCK} filled
 * from the ratifications table (Part 6.5). Model claude-sonnet-4-6, temp 0.
 *
 * The RULES paragraph is canon math, so it is recomputed here and the
 * deterministic result is what gets stored: any failed gate => tier X, score
 * capped 39; otherwise score = sum(dims) + 10 base + penalties; tiers
 * A >= 75, B 55-74, C 40-54. A model that returns arithmetic disagreeing with
 * its own rubric lines loses to the arithmetic.
 */
import { readFileSync } from 'node:fs'
import { sizeBandLabel, sizeBandPoints, TIER_CUTS } from '@/config/limits'
import { METRO_TERMS } from '@/config/metros'
import { getSqlite } from '@/db/connection'
import type BetterSqlite3 from 'better-sqlite3'
import type { Tier } from '@/db/enums'
import { minorIndication } from '@/lib/eligibility'
import { assembleScorePrompt } from '@/prompts/fewshot'
import { callJson, MODELS } from './llm'
import type { ScoreResult } from './types'

/**
 * score_v2 (ratified A2) = score_v1 with the `{NYC metro}` / `{South Florida}`
 * placeholders rendered from config/metros.ts. The on-disk prompt file stays
 * byte-identical to the blueprint's 6.2 fence — like {FEW_SHOT_BLOCK}, the
 * metro slots are filled at render time, so metros remain CONFIG, not prompt
 * text (Part 4.5), and wave three is still just a config block.
 */
const PROMPT_PATH = 'prompts/score_v2.md'
/**
 * BUMPED, not reused. The string `score_v2` is already stored on the 32 rows
 * the v1 rubric scored (it meant "score_v1.md + metro injection"), so reusing
 * it would make the old and new judgments indistinguishable in every later
 * query — including the golden set's. The version counts RUBRIC REVISIONS; the
 * file name counts files, and they are off by one for that reason.
 */
export const SCORE_PROMPT_VERSION = 'score_v3'
/** Kept on disk, unrendered: the rubric the A2 calibration batch was scored by. */
export const SCORE_PROMPT_V1_PATH = 'prompts/score_v1.md'

export function injectMetroTerms(template: string): string {
  return template
    .replace('{NYC metro}', `the NYC metro (${METRO_TERMS.nyc.join(', ')})`)
    .replace('{South Florida}', `South Florida (${METRO_TERMS.sofla.join(', ')})`)
}

/** The prompt as actually sent: canon text + metro terms + few-shot block. */
export function renderScorePrompt(sqlite?: BetterSqlite3.Database): string {
  return assembleScorePrompt(injectMetroTerms(readFileSync(PROMPT_PATH, 'utf8')), sqlite)
}

const GATE_KEYS = ['sells_online_coaching', 'is_individual_coach', 'alive_30d'] as const
/**
 * score_v3 (ratified 2026-08-30, the NATIONAL decision). Two changes, both
 * driven by the calibration evidence rather than by taste:
 *
 *   metro 15 -> 5, reframed as a bonus. It carried ZERO discriminating signal:
 *     30 of 32 profiles scored 0/15, including every single approval. Fifteen
 *     points that nobody could earn are not a dimension, they are a ceiling.
 *
 *   the freed 10 points went 7 to dm_run and 3 to online_purity, matching the
 *     observed gap between approvals and banks on the gate-passing profiles
 *     (dm_run 22.3 vs 14.8, purity 13.0 vs 10.8 — a ratio of roughly 3:1).
 *     Splitting them evenly would have over-weighted purity against evidence.
 */
const DIM_LIMITS = {
  dm_run: 32, size_band: 20, metro: 5, online_purity: 18, activity: 10, engagement_proxy: 5,
} as const

function num(v: unknown, lo: number, hi: number, name: string): number {
  if (typeof v !== 'number' || Number.isNaN(v) || v < lo || v > hi) {
    throw new Error(`${name} must be a number in [${lo}, ${hi}]`)
  }
  return v
}

function str(v: unknown, name: string): string {
  if (typeof v !== 'string') throw new Error(`${name} must be a string`)
  return v
}

export function validateScore(parsed: unknown): ScoreResult {
  const p = parsed as Record<string, any>
  if (!p || typeof p !== 'object') throw new Error('not an object')

  for (const key of GATE_KEYS) {
    const gate = p.gates?.[key]
    if (typeof gate?.pass !== 'boolean') throw new Error(`gates.${key}.pass must be boolean`)
    str(gate.evidence, `gates.${key}.evidence`)
  }
  for (const [key, max] of Object.entries(DIM_LIMITS)) {
    const dim = p.dims?.[key]
    num(dim?.pts, 0, max, `dims.${key}.pts`)
    str(dim?.evidence, `dims.${key}.evidence`)
  }
  const metro = p.dims.metro
  if (!['nyc', 'sofla', 'other', 'unknown'].includes(metro.metro)) {
    throw new Error('dims.metro.metro must be nyc|sofla|other|unknown')
  }
  num(metro.confidence, 0, 1, 'dims.metro.confidence')
  num(p.penalties?.incumbent_tooling?.pts, -10, 0, 'penalties.incumbent_tooling.pts')
  str(p.penalties.incumbent_tooling.evidence, 'penalties.incumbent_tooling.evidence')
  if (!Array.isArray(p.stack_signals)) throw new Error('stack_signals must be an array')
  str(p.extracted?.name, 'extracted.name')
  if (!Array.isArray(p.extracted?.offers)) throw new Error('extracted.offers must be an array')
  str(p.hook_draft, 'hook_draft')
  num(p.score, 0, 100, 'score')
  if (!['A', 'B', 'C', 'X'].includes(p.tier)) throw new Error('tier must be A|B|C|X')
  return p as ScoreResult
}

/**
 * The ratified size curve, APPLIED IN CODE rather than asked of the model.
 *
 * follower_count is a known integer and the curve is a lookup table — there is
 * no judgement in it, so there is nothing for a model to be good at. And the
 * A2 run measured what happens when arithmetic is left to the model: it
 * disagreed with its own rubric on 24 of 32 profiles. A seven-band table
 * evaluated by hand every time is that failure waiting to recur, on the single
 * dimension the operator most recently re-cut.
 *
 * The model still reports its own reading (the prompt says so, and its evidence
 * string is worth keeping in view), but the stored points come from
 * config/limits.ts and the evidence line says which band and why.
 */
export function applySizeBand(r: ScoreResult, followerCount: number | null): ScoreResult {
  const modelSaid = r.dims.size_band.pts
  const pts = sizeBandPoints(followerCount)
  return {
    ...r,
    dims: {
      ...r.dims,
      size_band: {
        ...r.dims.size_band,
        pts,
        evidence:
          `${sizeBandLabel(followerCount)} (ratified curve)` +
          (modelSaid !== pts ? ` [model read ${modelSaid}]` : ''),
      },
    },
  }
}

/** The RULES paragraph of the score prompt, as arithmetic. */
export function computeScoreAndTier(r: ScoreResult): { score: number; tier: Tier } {
  const dims = Object.values(r.dims).reduce((a, d) => a + d.pts, 0)
  const raw = dims + 10 + r.penalties.incumbent_tooling.pts
  const gateFailed = GATE_KEYS.some((k) => !r.gates[k].pass)
  const score = Math.max(0, Math.min(gateFailed ? 39 : 100, Math.round(raw)))
  const tier: Tier = gateFailed ? 'X'
    : score >= TIER_CUTS.A ? 'A'
    : score >= TIER_CUTS.B ? 'B'
    : score >= TIER_CUTS.C ? 'C'
    : 'X'
  return { score, tier }
}

/** Rubric lines for the evidence panel — structured prefix, human-readable body. */
export function evidenceLines(r: ScoreResult): string[] {
  const lines: string[] = []
  for (const key of GATE_KEYS) {
    const g = r.gates[key]
    lines.push(`GATE ${key}: ${g.pass ? 'PASS' : 'FAIL'} — ${g.evidence}`)
  }
  for (const [key, max] of Object.entries(DIM_LIMITS)) {
    const d = r.dims[key as keyof typeof r.dims]
    lines.push(`DIM ${key} ${d.pts}/${max} — ${d.evidence}`)
  }
  const pen = r.penalties.incumbent_tooling
  if (pen.pts !== 0 || pen.evidence.trim()) {
    lines.push(`PENALTY incumbent_tooling ${pen.pts} — ${pen.evidence}`)
  }
  return lines
}

/**
 * `claimed` is what the MODEL said before the RULES arithmetic overrode it,
 * and it is deliberately part of the return rather than a log line.
 *
 * The A2 calibration run found the model disagreeing with its own rubric on 24
 * of 32 profiles — almost always by exactly the +10 base it had not applied —
 * and 6 of the 7 B tiers existed only because the arithmetic corrected it. That
 * is a fact about prompt calibration, and it was recoverable only from console
 * scrollback: the DB stores the computed values, as it should, so the model's
 * own claim vanished the moment the terminal did. A score artifact that records
 * both can be diffed; one that records only the winner cannot.
 *
 * `null` for a deterministic X (a private account), where no prompt ran at all.
 */
export type ScoreOutcome =
  | { ok: true; tier: Tier; score: number; claimed: { tier: Tier; score: number } | null }
  | { ok: false; error: string }

export async function scoreCandidate(
  candidate: {
    id: number
    handle: string
    bio: string | null
    follower_count: number | null
    link_contents: string | null
    name?: string | null
  },
  /**
   * The enrichment packet, for captions and tags — Part 6.2's INPUT includes
   * "last ~6 captions" and comment-word CTAs live there. Part III persists no
   * captions column, so the orchestrator re-fetches the packet from the
   * provider at score time and hands it through. Absent packet = weaker input,
   * not a failure.
   */
  packet?: { captions?: string[]; tags?: string[]; isPrivate?: boolean | null } | null,
): Promise<ScoreOutcome> {
  const sqlite = getSqlite()

  // ── ELIGIBILITY, BEFORE ANYTHING IS PAID FOR (ratified A2 close) ────────
  // A minor is not a prospect at any score, so this is a gate rather than a
  // rubric line: it forces X without a model call and without weighing the
  // finding against a good DM funnel. The row still enters /ratify — the
  // operator has the last word here exactly as they do on a private account.
  // `score_prompt_version` stays NULL, the marker that no prompt ran.
  const minor = minorIndication(candidate.bio, candidate.name ?? null)
  if (minor) {
    const at = new Date().toISOString()
    sqlite
      .prepare(
        `UPDATE candidates SET score = 0, tier = 'X', score_failed = 0,
           evidence = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        JSON.stringify([
          `GATE eligibility: FAIL — ${minor.why} (matched "${minor.matched}")`,
          'ineligible regardless of score: an account holder who is a minor is not a prospect',
          'scored X deterministically before any paid call (operator ruling, A2 calibration close)',
        ]),
        at, candidate.id,
      )
    return { ok: true, tier: 'X', score: 0, claimed: null }
  }

  // A private account is an honest X, and a FREE one (Law 5 / operator ruling,
  // A2 calibration). Its posts are not public, so alive_30d and the whole
  // content half of Part 6.2 have nothing to read; paying a frontier model to
  // conclude that from an empty captions array is waste. The row still enters
  // /ratify — the operator, not this branch, has the last word.
  //
  // `score_prompt_version` is left NULL on purpose: it is the marker that no
  // prompt ran, which keeps deterministic X's distinguishable from scored ones
  // in every later query, including the golden set's.
  if (packet?.isPrivate === true) {
    const at = new Date().toISOString()
    sqlite
      .prepare(
        `UPDATE candidates SET score = 0, tier = 'X', score_failed = 0,
           evidence = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        JSON.stringify([
          'private account — posts are not publicly readable, so activity and content signals cannot be assessed',
          'scored X deterministically without a paid model call (Law 5: public surface only)',
        ]),
        at, candidate.id,
      )
    return { ok: true, tier: 'X', score: 0, claimed: null }
  }

  const system = renderScorePrompt(sqlite)

  const user = JSON.stringify({
    handle: candidate.handle,
    bio: candidate.bio,
    follower_count: candidate.follower_count,
    captions: packet?.captions ?? [],
    link_page_text: candidate.link_contents,
    tags: packet?.tags ?? [],
  })

  const result = await callJson({
    model: MODELS.score,
    system,
    user,
    maxTokens: 2000,
    runRef: `score:${candidate.handle}`,
    validate: validateScore,
  })

  const now = new Date().toISOString()
  if (!result.ok) {
    // Part 6.2: one retry happened inside callJson; flag for manual review.
    sqlite
      .prepare('UPDATE candidates SET score_failed = 1, updated_at = ? WHERE id = ?')
      .run(now, candidate.id)
    return { ok: false, error: result.error }
  }

  // The ratified size curve replaces the model's reading BEFORE the arithmetic
  // and before the evidence panel, so both report the value actually stored.
  const r = applySizeBand(result.value, candidate.follower_count)
  const { score, tier } = computeScoreAndTier(r)
  if (score !== Math.round(r.score) || tier !== r.tier) {
    console.warn(
      `  score:${candidate.handle} — model said ${r.tier} ${r.score}, RULES compute ${tier} ${score}; storing the computed values`,
    )
  }

  sqlite
    .prepare(
      `UPDATE candidates SET
         score = ?, tier = ?, score_prompt_version = ?, score_failed = 0,
         evidence = ?, hook_draft = ?, stack_signals = ?, extracted = ?,
         metro = ?, metro_confidence = ?, name = COALESCE(name, ?), updated_at = ?
       WHERE id = ?`,
    )
    .run(
      score, tier, SCORE_PROMPT_VERSION,
      JSON.stringify(evidenceLines(r)), r.hook_draft,
      JSON.stringify(r.stack_signals), JSON.stringify(r.extracted),
      r.dims.metro.metro, r.dims.metro.confidence,
      r.extracted.name || null, now, candidate.id,
    )
  return { ok: true, tier, score, claimed: { tier: r.tier, score: Math.round(r.score) } }
}
