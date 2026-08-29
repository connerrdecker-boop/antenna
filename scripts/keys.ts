/**
 * `npm run keys` — key presence report (Part 2.5 / Part X).
 *
 * Prints PRESENCE ONLY. No key value ever reaches stdout, a log, a spend
 * note, or the DB. The fingerprint is the first 8 hex of sha256(value): it is
 * one-way, so it cannot reconstruct the key, but it lets the operator confirm
 * that the key which LOADED is the key they intended — the difference between
 * "a key is set" and "the right key is set".
 *
 * A slot may accept more than one NAME. The Anthropic slot does, because the
 * deploy platform filters the reserved `ANTHROPIC_API_KEY` and hands the key
 * over as `ANTENNA_ANTHROPIC_KEY` instead (lib/env.ts). The report names which
 * alias actually supplied the key, so "present under the name I expected" is
 * visible rather than assumed.
 *
 * Exit 0 always: this is a diagnostic, not a gate. The gates live at the call
 * sites (requireAnthropicKey, the provider halts), where a missing key stops
 * the pipeline cleanly instead of guessing.
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { ANTHROPIC_KEY_NAMES, loadEnvLocal } from '@/lib/env'

/** `names` is in priority order — first non-empty wins, exactly as the resolver does. */
type KeySpec = { names: readonly string[]; used_by: string; where: string }

const KEYS: KeySpec[] = [
  { names: ANTHROPIC_KEY_NAMES, used_by: 'pre-score + full score (Part VI)', where: 'console.anthropic.com' },
  { names: ['APIFY_TOKEN'], used_by: 'profile/hashtag actors (Part 4b, Part V enrich)', where: 'apify.com' },
  { names: ['SERPER_API_KEY'], used_by: 'seller-exhaust SERP (Part 4a)', where: 'serper.dev' },
]

/** The name the operator should write in .env.local when the slot is empty. */
const canonical = (k: KeySpec) => k.names[0]

function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 8)
}

function resolve(k: KeySpec): { name: string; value: string } | null {
  for (const name of k.names) {
    const value = process.env[name]?.trim()
    if (value) return { name, value }
  }
  return null
}

const ENV_PATH = '.env.local'
const fileExists = existsSync(ENV_PATH)

// Snapshot what the process already carried, so the report can distinguish a
// key supplied by the environment from one read out of .env.local. They fail
// in different places and are fixed in different places.
const preexisting = new Set(
  KEYS.flatMap((k) => k.names).filter((n) => process.env[n]?.trim()),
)

loadEnvLocal(ENV_PATH)

console.log('\nKEY PRESENCE — values are never printed\n')
console.log(`  ${ENV_PATH}: ${fileExists ? 'found' : 'NOT FOUND in this working directory'}`)
console.log('')

const PAD = Math.max(...KEYS.flatMap((k) => k.names.map((n) => n.length)))

let missing = 0
for (const k of KEYS) {
  const found = resolve(k)
  if (!found) {
    missing++
    console.log(`  ${canonical(k).padEnd(PAD)} absent        — ${k.used_by}`)
    if (k.names.length > 1) {
      console.log(`  ${''.padEnd(PAD)}               (also accepted: ${k.names.slice(1).join(', ')})`)
    }
    continue
  }
  const source = preexisting.has(found.name) ? 'process env' : `${ENV_PATH}`
  const alias = found.name === canonical(k) ? '' : `  ← fallback name, canonical is ${canonical(k)}`
  console.log(
    `  ${found.name.padEnd(PAD)} PRESENT       — ${found.value.length} chars · ` +
    `sha256:${fingerprint(found.value)} · from ${source}${alias}`,
  )
}

console.log('')
if (missing) {
  console.log(`  ${missing} of ${KEYS.length} absent. Every step that needs one halts cleanly and names it;`)
  console.log('  nothing fabricates a value or a result. Add them to .env.local (gitignored):')
  console.log('')
  for (const k of KEYS) {
    if (!resolve(k)) console.log(`    ${canonical(k)}=...        # ${k.where}`)
  }
  console.log('')
} else {
  console.log('  All three present.\n')
}
