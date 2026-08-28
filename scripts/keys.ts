/**
 * `npm run keys` — key presence report (Part 2.5 / Part X).
 *
 * Prints PRESENCE ONLY. No key value ever reaches stdout, a log, a spend
 * note, or the DB. The fingerprint is the first 8 hex of sha256(value): it is
 * one-way, so it cannot reconstruct the key, but it lets the operator confirm
 * that the key which LOADED is the key they intended — the difference between
 * "a key is set" and "the right key is set".
 *
 * Exit 0 always: this is a diagnostic, not a gate. The gates live at the call
 * sites (requireAnthropicKey, the provider halts), where a missing key stops
 * the pipeline cleanly instead of guessing.
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { loadEnvLocal } from '@/lib/env'

type KeySpec = { name: string; used_by: string; where: string }

const KEYS: KeySpec[] = [
  { name: 'ANTHROPIC_API_KEY', used_by: 'pre-score + full score (Part VI)', where: 'console.anthropic.com' },
  { name: 'APIFY_TOKEN', used_by: 'profile/hashtag actors (Part 4b, Part V enrich)', where: 'apify.com' },
  { name: 'SERPER_API_KEY', used_by: 'seller-exhaust SERP (Part 4a)', where: 'serper.dev' },
]

function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 8)
}

const ENV_PATH = '.env.local'
const fileExists = existsSync(ENV_PATH)

// Snapshot what the process already carried, so the report can distinguish a
// key supplied by the environment from one read out of .env.local. They fail
// in different places and are fixed in different places.
const preexisting = new Set(KEYS.filter((k) => process.env[k.name]?.trim()).map((k) => k.name))

loadEnvLocal(ENV_PATH)

console.log('\nKEY PRESENCE — values are never printed\n')
console.log(`  ${ENV_PATH}: ${fileExists ? 'found' : 'NOT FOUND in this working directory'}`)
console.log('')

let missing = 0
for (const k of KEYS) {
  const raw = process.env[k.name]
  const value = raw?.trim() ?? ''
  if (!value) {
    missing++
    console.log(`  ${k.name.padEnd(18)} absent        — ${k.used_by}`)
    continue
  }
  const source = preexisting.has(k.name) ? 'process env' : `${ENV_PATH}`
  console.log(
    `  ${k.name.padEnd(18)} PRESENT       — ${value.length} chars · sha256:${fingerprint(value)} · from ${source}`,
  )
}

console.log('')
if (missing) {
  console.log(`  ${missing} of ${KEYS.length} absent. Every step that needs one halts cleanly and names it;`)
  console.log('  nothing fabricates a value or a result. Add them to .env.local (gitignored):')
  console.log('')
  for (const k of KEYS) {
    if (!process.env[k.name]?.trim()) console.log(`    ${k.name}=...        # ${k.where}`)
  }
  console.log('')
} else {
  console.log('  All three present.\n')
}
