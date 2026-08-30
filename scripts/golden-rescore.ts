/**
 * The `--rescore` half of Part 6.6, in its own module so the default offline
 * path never imports the Anthropic SDK or requires a key.
 *
 * It scores the FROZEN inputs — not the live candidates table — through the
 * current prompt and the current few-shot block. That distinction is the whole
 * point: re-reading the database would score whatever enrichment last wrote,
 * so a prompt that got worse and an actor whose output changed would be
 * indistinguishable. Frozen inputs isolate the one variable under test.
 *
 * Nothing here writes to the database. A regression run must not move a real
 * candidate's tier, and must not touch the ratifications that calibrate it.
 */
import { callJson, MODELS } from '@/pipeline/llm'
import { applySizeBand, computeScoreAndTier, renderScorePrompt, validateScore } from '@/pipeline/score'

type Entry = { fp: string; expected: 'A' | 'not-A' | null }
type InputEntry = {
  fp: string; handle: string; bio: string | null; follower_count: number | null
  captions: string[]; tags: string[]; link_page_text: string | null
}

/**
 * Returns fingerprint -> tier, computed by the RULES arithmetic exactly as
 * pipeline/score.ts does, so the regression measures the same number the
 * pipeline would have stored.
 */
export async function scoreGoldenInput(
  entries: Entry[],
  inputOf: Map<string, InputEntry>,
): Promise<Map<string, string | null>> {
  const system = renderScorePrompt()
  const out = new Map<string, string | null>()

  for (const e of entries) {
    const input = inputOf.get(e.fp)
    if (!input) continue

    const user = JSON.stringify({
      handle: input.handle,
      bio: input.bio,
      follower_count: input.follower_count,
      captions: input.captions,
      link_page_text: input.link_page_text,
      tags: input.tags,
    })

    const res = await callJson({
      model: MODELS.score,
      system,
      user,
      maxTokens: 2000,
      runRef: `golden:${e.fp}`,
      validate: validateScore,
    })

    // A profile the scorer cannot produce valid JSON for is not an A. Recording
    // it as null rather than skipping keeps the denominator honest — a set that
    // quietly drops its failures reports a better agreement rate than it earned.
    // Same curve as the pipeline. A regression run that skipped it would be
    // measuring a rubric the pipeline does not use.
    out.set(
      e.fp,
      res.ok ? computeScoreAndTier(applySizeBand(res.value, input.follower_count)).tier : null,
    )
    process.stdout.write(res.ok ? '.' : '!')
  }
  process.stdout.write('\n')
  return out
}
