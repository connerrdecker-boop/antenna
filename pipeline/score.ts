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
import { TIER_CUTS } from '@/config/limits'
import { getSqlite } from '@/db/connection'
import type { Tier } from '@/db/enums'
import { assembleScorePrompt } from '@/prompts/fewshot'
import { callJson, MODELS } from './llm'
import type { ScoreResult } from './types'

const PROMPT_PATH = 'prompts/score_v1.md'
export const SCORE_PROMPT_VERSION = 'score_v1'

const GATE_KEYS = ['sells_online_coaching', 'is_individual_coach', 'alive_30d'] as const
const DIM_LIMITS = {
  dm_run: 25, size_band: 20, metro: 15, online_purity: 15, activity: 10, engagement_proxy: 5,
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

/** The RULES paragraph of prompts/score_v1.md, as arithmetic. */
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

export type ScoreOutcome =
  | { ok: true; tier: Tier; score: number }
  | { ok: false; error: string }

export async function scoreCandidate(
  candidate: {
    id: number
    handle: string
    bio: string | null
    follower_count: number | null
    link_contents: string | null
  },
  /**
   * The enrichment packet, for captions and tags — Part 6.2's INPUT includes
   * "last ~6 captions" and comment-word CTAs live there. Part III persists no
   * captions column, so the orchestrator re-fetches the packet from the
   * provider at score time and hands it through. Absent packet = weaker input,
   * not a failure.
   */
  packet?: { captions?: string[]; tags?: string[] } | null,
): Promise<ScoreOutcome> {
  const sqlite = getSqlite()
  const template = readFileSync(PROMPT_PATH, 'utf8')
  const system = assembleScorePrompt(template, sqlite)

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

  const r = result.value
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
  return { ok: true, tier, score }
}
