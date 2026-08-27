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
 * The scoring steps call this before any LLM work. Absent key = clean halt
 * naming exactly what to add — never a crash, never a fake score.
 */
export function requireAnthropicKey(): string {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key || !key.trim()) {
    throw new PipelineHalt(
      [
        'ANTHROPIC_API_KEY is not set — the pipeline halts at the scoring step.',
        '',
        'To fix: create .env.local in the repo root (it is gitignored) containing:',
        '',
        '  ANTHROPIC_API_KEY=sk-ant-api03-...',
        '',
        'Get a key from console.anthropic.com (the API console — separate from a',
        'Claude subscription). Everything before scoring (enrichment, observations)',
        'has already been saved; re-run the pipeline once the key is in place.',
      ].join('\n'),
    )
  }
  return key
}
