/**
 * `npm run golden:build` — freeze the A2 calibration batch into the Part 6.6
 * regression set, from the operator's ratify verdicts.
 *
 * WHY TWO FILES, AND WHY THAT IS NOT FUSSINESS. Part 6.6 wants FROZEN profiles
 * — a regression test whose inputs drift is not a regression test — and the
 * scorer's input is a bio and six captions, which is person-linked. Part 2.3
 * (canon line 178) lists `golden/set.json` as COMMITTED, and describes it as
 * "our tier labels". Those two facts only fit together one way:
 *
 *   golden/set.json     LABELS. Person-free: a handle FINGERPRINT, the
 *                       operator's decision, and the expected tier. COMMITTED,
 *                       so the regression contract is versioned with the code.
 *   golden/inputs.json  The frozen scorer INPUT keyed by the same fingerprint.
 *                       Person-linked, so GITIGNORED, carried by the remote
 *                       store, and purged by `npm run forget` like every other
 *                       person-linked copy.
 *
 * Committing the inputs would put a coach's bio in git history, where Law 5's
 * "trivial delete-on-request" becomes a history rewrite — the exact reasoning
 * that keeps `state/snapshot.json` out of git. The fingerprint is the same
 * device `lib/tombstones.ts` already uses, and carries the same honest caveat:
 * pseudonymous, not anonymous.
 *
 * THE TIERS ARE TRANSCRIBED, NOT DERIVED. The table below is written out by
 * hand from the operator's verdicts, exactly as `check.ts` transcribes
 * CANON_TRANSITIONS from the blueprint rather than importing `lib/status.ts`.
 * A golden set built by SELECTing the tiers the scorer produced could only ever
 * agree with the scorer; it would regress to the mean of whatever the model did
 * last and catch nothing. Ground truth here is the OPERATOR'S DECISION.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { getSqlite } from '@/db/connection'
import { loadEnvLocal, PipelineHalt } from '@/lib/env'
import { handleFingerprint } from '@/lib/tombstones'
import { CALIBRATION_PACKETS_PATH } from '@/lib/stateExport'
import { existsSync, readFileSync } from 'node:fs'
import type { ProfilePacket } from '@/pipeline/types'

export const GOLDEN_SET = 'golden/set.json'
export const GOLDEN_INPUTS = 'golden/inputs.json'
export const GOLDEN_SCHEMA = 1

/**
 * The operator's verdicts, transcribed. `expected` is the A-vs-not-A ground
 * truth Part 6.6 measures on:
 *
 *   approve -> 'A'      the operator would DM this person
 *   reject  -> 'not-A'  the operator would not
 *   bank    -> null     "right coach, wrong wave" — a real coach held for a
 *   flag    -> null     later wave, or an undecided profile. Neither is a
 *                       scoring error in either direction, so both are FROZEN
 *                       in the set but EXCLUDED from the agreement metric.
 *                       Scoring them as failures would train the rubric to
 *                       reject good coaches for being early.
 */
type Label = { handle: string; decision: 'approve' | 'reject' | 'bank' | 'flag'; expected: 'A' | 'not-A' | null }

const LABELS: Label[] = [
  { handle: 'hunterstein_wk', decision: 'bank', expected: null },
  { handle: 'down_ethan', decision: 'approve', expected: 'A' },
  { handle: 'ace.dressler', decision: 'approve', expected: 'A' },
  { handle: 'santinoanzevino', decision: 'bank', expected: null },
  { handle: 'benkumpofficial', decision: 'approve', expected: 'A' },
  { handle: 'chris.cxpa', decision: 'approve', expected: 'A' },
  { handle: 'koda.kammer', decision: 'bank', expected: null },
  { handle: 'michaeljuliuss', decision: 'bank', expected: null },
  { handle: 'austinalwayslifting', decision: 'reject', expected: 'not-A' },
  { handle: 'cruzbrahh', decision: 'flag', expected: null },
  { handle: 'harryraftus', decision: 'reject', expected: 'not-A' },
  { handle: 'jacknormaan', decision: 'reject', expected: 'not-A' },
  { handle: 'brandonkennedyy', decision: 'reject', expected: 'not-A' },
  { handle: 'heath.lifts', decision: 'bank', expected: null },
  { handle: 'kylekuznik', decision: 'reject', expected: 'not-A' },
  { handle: 'cmartyfit', decision: 'reject', expected: 'not-A' },
  { handle: 'tommy_lifts10', decision: 'reject', expected: 'not-A' },
  { handle: 'tyrounsaville1', decision: 'reject', expected: 'not-A' },
  { handle: 'nathannfrench', decision: 'reject', expected: 'not-A' },
  { handle: 'teosworld_', decision: 'reject', expected: 'not-A' },
  { handle: '_lucasaiello', decision: 'bank', expected: null },
  { handle: 'brennancjennings', decision: 'reject', expected: 'not-A' },
  { handle: 'conner_felts', decision: 'reject', expected: 'not-A' },
  { handle: 'jakeclayfit', decision: 'reject', expected: 'not-A' },
  { handle: 'jet_ohler', decision: 'reject', expected: 'not-A' },
  { handle: 'lukeewesttt', decision: 'reject', expected: 'not-A' },
  { handle: 'aidengithens', decision: 'reject', expected: 'not-A' },
  { handle: 'hayeskrause', decision: 'reject', expected: 'not-A' },
  { handle: 'matthewscriv', decision: 'reject', expected: 'not-A' },
  { handle: 'zachtaylorfit_', decision: 'reject', expected: 'not-A' },
  { handle: 'anderson_kaufman', decision: 'reject', expected: 'not-A' },
  { handle: 'kieron.hall', decision: 'reject', expected: 'not-A' },
]

function main(): void {
  loadEnvLocal()
  const sqlite = getSqlite()

  // The transcription is checked against the database rather than trusted: a
  // hand-written table is only useful if a typo in it FAILS rather than
  // silently labels the wrong person.
  const actual = new Map(
    (sqlite
      .prepare(
        `SELECT c.handle, r.decision, c.tier, c.score, c.bio, c.follower_count, c.link_contents
           FROM candidates c
           JOIN ratifications r ON r.candidate_id = c.id
          WHERE c.notes LIKE '%score_context=calibration%'`,
      )
      .all() as {
        handle: string; decision: string; tier: string | null; score: number | null
        bio: string | null; follower_count: number | null; link_contents: string | null
      }[]).map((r) => [r.handle, r]),
  )

  const mismatches: string[] = []
  for (const l of LABELS) {
    const a = actual.get(l.handle)
    if (!a) { mismatches.push(`@${l.handle}: no ratification in the DB`); continue }
    if (a.decision !== l.decision) {
      mismatches.push(`@${l.handle}: transcribed "${l.decision}", DB has "${a.decision}"`)
    }
  }
  if (mismatches.length) {
    throw new PipelineHalt(
      'TRANSCRIPTION DOES NOT MATCH THE RATIFICATIONS — refusing to freeze a golden set ' +
      'that disagrees with the decisions it claims to encode:\n\n' +
      mismatches.map((m) => `  ${m}`).join('\n'),
    )
  }
  if (actual.size !== LABELS.length) {
    throw new PipelineHalt(
      `The DB holds ${actual.size} ratified calibration candidates but ${LABELS.length} were transcribed.`,
    )
  }

  const packets: ProfilePacket[] = existsSync(CALIBRATION_PACKETS_PATH)
    ? (JSON.parse(readFileSync(CALIBRATION_PACKETS_PATH, 'utf8')) as ProfilePacket[])
    : []
  const packetOf = new Map(packets.map((p) => [p.handle.toLowerCase(), p]))

  const at = new Date().toISOString()

  // ── the COMMITTED half: labels only, person-free ────────────────────────
  const set = {
    schema: GOLDEN_SCHEMA,
    built_at: at,
    source: 'A2 calibration batch, 32 profiles, frozen at the operator ratify pass',
    prompt_version: 'score_v2',
    /** Part 6.6: >=90% agreement on A-vs-not-A, measured over `expected !== null`. */
    agreement_threshold: 0.9,
    note:
      'Person-free by construction: fingerprints and labels only. The frozen scorer ' +
      'inputs live in golden/inputs.json, which is gitignored (Law 5) and carried by ' +
      'the remote state store. Fingerprints are pseudonymous, not anonymous — see lib/tombstones.ts.',
    entries: LABELS.map((l) => ({
      fp: handleFingerprint(l.handle),
      decision: l.decision,
      expected: l.expected,
      /** What the scorer said at freeze time — the baseline a re-score is compared against. */
      scored_tier: actual.get(l.handle)!.tier,
      scored_score: actual.get(l.handle)!.score,
    })),
  }

  // ── the GITIGNORED half: the frozen inputs ──────────────────────────────
  const inputs = {
    schema: GOLDEN_SCHEMA,
    built_at: at,
    note: 'PERSON-LINKED. Gitignored, pushed to the remote store, purged by npm run forget.',
    entries: LABELS.map((l) => {
      const a = actual.get(l.handle)!
      const p = packetOf.get(l.handle.toLowerCase())
      return {
        fp: handleFingerprint(l.handle),
        handle: l.handle,
        bio: a.bio,
        follower_count: a.follower_count,
        captions: p?.captions ?? [],
        tags: p?.tags ?? [],
        link_page_text: a.link_contents,
      }
    }),
  }

  mkdirSync('golden', { recursive: true })
  writeFileSync(GOLDEN_SET, JSON.stringify(set, null, 2) + '\n')
  writeFileSync(GOLDEN_INPUTS, JSON.stringify(inputs, null, 2) + '\n')

  const measured = LABELS.filter((l) => l.expected !== null)
  console.log(`\nGOLDEN SET FROZEN — ${LABELS.length} profiles\n`)
  console.log(`  ${GOLDEN_SET.padEnd(20)} labels only · person-free · COMMITTED`)
  console.log(`  ${GOLDEN_INPUTS.padEnd(20)} frozen inputs · person-linked · gitignored`)
  console.log('')
  console.log(`  measured on A-vs-not-A: ${measured.length} (${measured.filter((l) => l.expected === 'A').length} A · ${measured.filter((l) => l.expected === 'not-A').length} not-A)`)
  console.log(`  excluded (bank/flag):   ${LABELS.length - measured.length}`)
  console.log(`  threshold:              ${(set.agreement_threshold * 100).toFixed(0)}% (Part 6.6)`)
  console.log('')
  console.log(`  captions frozen for ${inputs.entries.filter((e) => e.captions.length > 0).length} of ${LABELS.length}\n`)
}

main()
