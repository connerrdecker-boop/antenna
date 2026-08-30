/**
 * `npm run check:golden` — Part 6.6, the scoring regression test.
 *
 * "Re-scores golden/set.json against the current prompt + few-shot block and
 * asserts >=90% A-vs-not-A tier agreement. Run after every prompt or few-shot
 * change. This is how 'tune the rubric' never silently becomes 'break the
 * rubric.'"
 *
 * TWO MODES, AND WHY THE DEFAULT IS THE OFFLINE ONE. This script is chained
 * into `npm run check`, which runs constantly. A live re-score is 32 frontier
 * model calls — real money, and it needs a key — so making that the default
 * would put a bill on every `npm run check` and turn the suite red on any
 * machine without an Anthropic key. Neither is what a regression test is for.
 *
 *   default     Compares the STORED scores against the operator's labels, with
 *               no model calls. Answers "does the current scoring state still
 *               agree with the ratify pass?" — which is what a check run wants
 *               to know, and it is free.
 *   --rescore   The canon behaviour: re-score every frozen input through the
 *               CURRENT prompt + few-shot block and compare. This is the one
 *               to run after a prompt or few-shot change, because it is the
 *               only mode that can see a prompt edit at all.
 *
 * AGREEMENT IS MEASURED ON A-vs-NOT-A, over entries whose expected label is
 * non-null. `bank` and `flag` are frozen in the set but excluded: a banked
 * profile is a real coach held for a later wave, so counting it as a scoring
 * failure would train the rubric to reject good coaches for being early.
 */
import { existsSync, readFileSync } from 'node:fs'
import { getSqlite } from '@/db/connection'
import { loadEnvLocal, PipelineHalt } from '@/lib/env'
import { handleFingerprint } from '@/lib/tombstones'

const SET = 'golden/set.json'
const INPUTS = 'golden/inputs.json'

type Entry = {
  fp: string
  decision: 'approve' | 'reject' | 'bank' | 'flag'
  expected: 'A' | 'not-A' | null
  scored_tier: string | null
  scored_score: number | null
}
type GoldenSet = {
  schema: number
  built_at: string
  prompt_version: string
  agreement_threshold: number
  entries: Entry[]
}
type InputEntry = {
  fp: string; handle: string; bio: string | null; follower_count: number | null
  captions: string[]; tags: string[]; link_page_text: string | null
}

const flag = (n: string) => process.argv.includes(`--${n}`)

/** A-vs-not-A: only tier A counts as A. Everything else is not-A. */
const sideOf = (tier: string | null): 'A' | 'not-A' => (tier === 'A' ? 'A' : 'not-A')

async function main(): Promise<void> {
  loadEnvLocal()

  if (!existsSync(SET)) {
    console.log('golden set: PENDING')
    console.log(`  ${SET} does not exist yet — build it from a ratify pass: npm run golden:build`)
    console.log('  Until then there is nothing to regress against. This is not a pass.')
    process.exit(0)
  }

  const set = JSON.parse(readFileSync(SET, 'utf8')) as GoldenSet
  const measured = set.entries.filter((e) => e.expected !== null)
  if (!measured.length) {
    console.error('golden set: RED — the set carries no A-vs-not-A labels to measure.')
    process.exit(1)
  }

  let observed: Map<string, string | null>
  let mode: string

  if (flag('rescore')) {
    // ── canon mode: re-score through the CURRENT prompt + few-shot ────────
    if (!existsSync(INPUTS)) {
      throw new PipelineHalt(
        `${INPUTS} is missing — it is person-linked and gitignored (Law 5), so a fresh container ` +
        'does not have it. Recover it with `npm run state:pull`, or rebuild it from a ratify pass ' +
        'with `npm run golden:build`. Refusing to re-score against inputs that are not the frozen ones.',
      )
    }
    const { entries } = JSON.parse(readFileSync(INPUTS, 'utf8')) as { entries: InputEntry[] }
    const inputOf = new Map(entries.map((e) => [e.fp, e]))
    // Imported lazily: the offline path must not require a key or the SDK.
    const { scoreGoldenInput } = await import('./golden-rescore')
    observed = await scoreGoldenInput(set.entries, inputOf)
    mode = 'RE-SCORED against the current prompt + few-shot block'
  } else {
    // ── default: the stored scores, no model calls ────────────────────────
    const sqlite = getSqlite()
    const rows = sqlite
      .prepare("SELECT handle, tier FROM candidates WHERE notes LIKE '%score_context=calibration%'")
      .all() as { handle: string; tier: string | null }[]
    observed = new Map(rows.map((r) => [handleFingerprint(r.handle), r.tier]))
    mode = 'stored scores (no model calls) — use --rescore after a prompt or few-shot change'
  }

  const missing = measured.filter((e) => !observed.has(e.fp))
  if (missing.length) {
    console.error(`golden set: RED — ${missing.length} of ${measured.length} labeled profiles are not present to score.`)
    console.error('  A golden set that silently shrinks stops being a regression test.')
    console.error(`  Recover the batch with \`npm run state:pull\`. Missing fingerprints: ${missing.slice(0, 4).map((m) => m.fp).join(', ')}`)
    process.exit(1)
  }

  const disagreements: string[] = []
  let agree = 0
  for (const e of measured) {
    const got = sideOf(observed.get(e.fp) ?? null)
    if (got === e.expected) agree++
    else disagreements.push(`  ${e.fp}  operator ${e.expected}  ·  scorer ${got} (tier ${observed.get(e.fp) ?? 'none'})`)
  }

  const rate = agree / measured.length
  const pass = rate >= set.agreement_threshold

  console.log(`golden set: ${pass ? 'GREEN' : 'RED'} — ${(rate * 100).toFixed(1)}% A-vs-not-A agreement ` +
    `(${agree}/${measured.length}, threshold ${(set.agreement_threshold * 100).toFixed(0)}%)`)
  console.log(`  set built ${set.built_at} · prompt ${set.prompt_version} · ${set.entries.length} frozen, ` +
    `${set.entries.length - measured.length} excluded (bank/flag)`)
  console.log(`  mode: ${mode}`)
  if (disagreements.length) {
    console.log('  disagreements:')
    for (const d of disagreements.slice(0, 10)) console.log(d)
  }
  process.exit(pass ? 0 : 1)
}

main().catch((e: unknown) => {
  if (e instanceof PipelineHalt) { console.error(`\n■ ${e.message}\n`); process.exit(2) }
  console.error(e)
  process.exit(1)
})
