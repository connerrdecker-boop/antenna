/**
 * The one Anthropic client (Part 2.2): claude-haiku-4-5 for pre-score,
 * claude-sonnet-4-6 for full score, temperature 0, JSON-only outputs.
 *
 * Contract per Part 6.2: strip code fences, parse; on invalid JSON retry once,
 * then the caller flags score_failed. Every call is budget-gated before it
 * happens (Part X) and writes actual spend from API usage after.
 *
 * The key is read from .env.local; a missing key halts the pipeline with a
 * message naming exactly what to add — never a crash, never a fake score.
 */
import Anthropic from '@anthropic-ai/sdk'
import { PipelineHalt, requireAnthropicKey } from '@/lib/env'
import { ensureBudget, recordSpend } from './lib/budget'

/** Blueprint-named models (Part 2.2) — exact IDs, no date suffixes. */
export const MODELS = {
  prescore: 'claude-haiku-4-5',
  score: 'claude-sonnet-4-6',
} as const

/** USD per million tokens — used for the pre-call estimate and actual spend. */
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
}

let client: Anthropic | null = null
function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: requireAnthropicKey() })
  return client
}

/** Rough pre-call ceiling: chars/3.5 input tokens + the full output budget. */
export function estimateCost(model: string, promptChars: number, maxTokens: number): number {
  const p = PRICING[model]
  return (promptChars / 3.5 / 1e6) * p.input + (maxTokens / 1e6) * p.output
}

function actualCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICING[model]
  return (inputTokens / 1e6) * p.input + (outputTokens / 1e6) * p.output
}

/** ```json fences off, whitespace trimmed — the model was told JSON only. */
export function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```[a-zA-Z]*\s*\n?/, '')
    .replace(/\n?```\s*$/, '')
    .trim()
}

export type LlmJsonResult<T> =
  | { ok: true; value: T; retried: boolean }
  | { ok: false; error: string; raw: string }

/**
 * One JSON-only call with the canon retry policy: parse+validate, one retry,
 * then a failure the caller records as score_failed. Budget-gated; spend
 * logged from actual usage.
 */
export async function callJson<T>(opts: {
  model: (typeof MODELS)[keyof typeof MODELS]
  system: string
  user: string
  maxTokens: number
  runRef: string
  validate: (parsed: unknown) => T
}): Promise<LlmJsonResult<T>> {
  const { model, system, user, maxTokens, runRef, validate } = opts
  const anthropic = getClient()

  let lastError = ''
  let raw = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    ensureBudget('llm', estimateCost(model, system.length + user.length, maxTokens))

    let response: Anthropic.Message
    try {
      response = await anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        temperature: 0,
        system,
        messages: [{ role: 'user', content: user }],
      })
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) {
        throw new PipelineHalt(
          'The Anthropic API rejected the key (authentication error). Check ANTHROPIC_API_KEY ' +
          'in .env.local — it should start with sk-ant- and come from console.anthropic.com. ' +
          'Nothing was charged.',
        )
      }
      if (e instanceof Anthropic.RateLimitError) {
        throw new PipelineHalt(
          'The Anthropic API rate-limited us. Nothing is lost — wait a minute and re-run; ' +
          'the pipeline resumes where it stopped.',
        )
      }
      throw e
    }

    recordSpend(
      'llm',
      actualCost(model, response.usage.input_tokens, response.usage.output_tokens),
      runRef,
      `${model} in=${response.usage.input_tokens} out=${response.usage.output_tokens}${attempt ? ' (retry)' : ''}`,
    )

    raw = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')

    try {
      const parsed: unknown = JSON.parse(stripFences(raw))
      return { ok: true, value: validate(parsed), retried: attempt > 0 }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
      // Part 6.2: one retry, then flag score_failed for manual review.
    }
  }
  return { ok: false, error: lastError, raw }
}
