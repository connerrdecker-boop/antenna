/**
 * PART VI, stage 1 — the pre-score. Cheap model, bio-only inputs, kills the
 * obvious noise so the capable model never reads it.
 *
 * Prompt: prompts/prescore_v1.md, verbatim canon. Model claude-haiku-4-5,
 * temp 0, JSON only.
 */
import { readFileSync } from 'node:fs'
import { getSqlite } from '@/db/connection'
import { callJson, MODELS } from './llm'
import type { PrescoreResult } from './types'

const PROMPT_PATH = 'prompts/prescore_v1.md'

function validatePrescore(parsed: unknown): PrescoreResult {
  const p = parsed as Record<string, unknown>
  if (typeof p?.pre_score !== 'number' || p.pre_score < 0 || p.pre_score > 100) {
    throw new Error('pre_score must be a number 0-100')
  }
  if (!Array.isArray(p.kill_reasons)) throw new Error('kill_reasons must be an array')
  return { pre_score: Math.round(p.pre_score), kill_reasons: p.kill_reasons.map(String) }
}

export type PrescoreOutcome = { ok: true; preScore: number } | { ok: false; error: string }

export async function prescoreCandidate(candidate: {
  id: number
  handle: string
  bio: string | null
  follower_count: number | null
  link_domain: string | null
}): Promise<PrescoreOutcome> {
  const system = readFileSync(PROMPT_PATH, 'utf8')
  const user = JSON.stringify({
    handle: candidate.handle,
    bio: candidate.bio,
    follower_count: candidate.follower_count,
    link_domain: candidate.link_domain,
  })

  const result = await callJson({
    model: MODELS.prescore,
    system,
    user,
    maxTokens: 300,
    runRef: `prescore:${candidate.handle}`,
    validate: validatePrescore,
  })

  if (!result.ok) return { ok: false, error: result.error }

  const sqlite = getSqlite()
  const now = new Date().toISOString()
  // Below-threshold kill reasons are preserved for review; a candidate that
  // passes gets its evidence written by the full scorer instead.
  const killEvidence = result.value.kill_reasons.length
    ? JSON.stringify(result.value.kill_reasons.map((r) => `PRESCORE kill: ${r}`))
    : null
  sqlite
    .prepare('UPDATE candidates SET pre_score = ?, evidence = COALESCE(?, evidence), updated_at = ? WHERE id = ?')
    .run(result.value.pre_score, killEvidence, now, candidate.id)
  return { ok: true, preScore: result.value.pre_score }
}
