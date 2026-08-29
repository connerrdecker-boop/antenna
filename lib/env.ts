/**
 * .env.local loader for tsx scripts. Next.js loads .env.local itself; plain
 * tsx does not, so pipeline CLIs call loadEnvLocal() at entry.
 *
 * Keys are never committed, never echoed in logs (Part 2.5 / Part X) — this
 * module never prints a value, only presence.
 */
import { existsSync, readFileSync } from 'node:fs'

export function loadEnvLocal(path = '.env.local'): void {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m) continue
    const [, key, rawValue] = m
    if (process.env[key] !== undefined) continue
    const value = rawValue.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')
    process.env[key] = value
  }
}

/** Thrown to stop the pipeline cleanly — a message for the operator, not a stack trace. */
export class PipelineHalt extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PipelineHalt'
  }
}

/**
 * THE ANTHROPIC KEY, BY NAME — in priority order.
 *
 * The deployment platform filters the reserved name `ANTHROPIC_API_KEY` out of
 * the environment it hands this process, so the key arrives under a namespaced
 * alias. `ANTENNA_ANTHROPIC_KEY` is therefore CANONICAL: it is the name that
 * works everywhere this ships. `ANTHROPIC_API_KEY` stays as a fallback because
 * it is what the operator's Mac and every `.env.local` written before this
 * change already use, and silently breaking a working local setup to tidy a
 * name is not a trade worth making.
 *
 * First non-empty wins. Never reordered casually: the canonical name must lose
 * to nothing, or a stale local key would shadow the one the platform supplied.
 */
export const ANTHROPIC_KEY_NAMES = ['ANTENNA_ANTHROPIC_KEY', 'ANTHROPIC_API_KEY'] as const
export type AnthropicKeyName = (typeof ANTHROPIC_KEY_NAMES)[number]

/**
 * Which name supplied the key, and its value — or null if none did.
 *
 * Returns the NAME as well as the value so the operator-facing surfaces (the
 * key report, the settings page) can say which one loaded. "A key is set" and
 * "the key I meant is set" are different facts, and on a machine carrying both
 * names only the second one is worth printing.
 */
export function resolveAnthropicKey(): { name: AnthropicKeyName; value: string } | null {
  for (const name of ANTHROPIC_KEY_NAMES) {
    const value = process.env[name]?.trim()
    if (value) return { name, value }
  }
  return null
}

/** Presence only — never the value. For settings pages and reports. */
export function anthropicKeyPresent(): boolean {
  return resolveAnthropicKey() !== null
}

/**
 * The scoring steps call this before any LLM work. Absent key = clean halt
 * naming exactly what to add — never a crash, never a fake score.
 */
export function requireAnthropicKey(): string {
  const found = resolveAnthropicKey()
  if (found) return found.value
  throw new PipelineHalt(
    [
      `${ANTHROPIC_KEY_NAMES[0]} is not set — the pipeline halts at the scoring step.`,
      '',
      'To fix: create .env.local in the repo root (it is gitignored) containing:',
      '',
      `  ${ANTHROPIC_KEY_NAMES[0]}=sk-ant-api03-...`,
      '',
      `Accepted names, in priority order: ${ANTHROPIC_KEY_NAMES.join(', ')}.`,
      `${ANTHROPIC_KEY_NAMES[0]} is canonical — the deploy platform filters the reserved`,
      `name ${ANTHROPIC_KEY_NAMES[1]}, which still works locally.`,
      '',
      'Get a key from console.anthropic.com (the API console — separate from a',
      'Claude subscription). Everything before scoring (enrichment, observations)',
      'has already been saved; re-run the pipeline once the key is in place.',
    ].join('\n'),
  )
}
