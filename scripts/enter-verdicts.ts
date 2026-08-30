/**
 * `npm run verdicts` — enter the operator's ratify verdicts through the REAL
 * ratification path.
 *
 * Every decision goes through applyRatifyDecision(), so the ratifications row,
 * the Part 8.2 transition, the Law 10 gate and the write-through all fire
 * exactly as they would from the keyboard in /ratify. Nothing here writes a
 * status or a ratification directly.
 *
 * TWO THINGS THIS GUARDS, BOTH LOAD-BEARING:
 *
 * 1. THE QUEUE MOVES AS YOU RATIFY. Verdicts arrived as positions ("7 b"), and
 *    listRatifyQueue() only returns `sourced` rows — so every approve/reject/
 *    bank transition SHRINKS the queue and renumbers everything after it.
 *    Resolving position → handle lazily would land verdict 8 on the candidate
 *    who used to be 9. So the order is snapshotted ONCE, up front, and each
 *    verdict carries the handle it was written against; the handle is then
 *    asserted against the snapshot before anything is applied.
 *
 * 2. REJECT REASONS ARE A PICKER, NOT PROSE (Part VII, canon line 374:
 *    `n` reject → reason picker → not-a-coach / gym-floor / not-selling /
 *    too-big / too-small / dead / other). The operator's verdicts came as free
 *    text, which is richer than any of those seven words — and it is the
 *    training signal Part 6.5 feeds to the scorer, so losing it would be the
 *    real damage. So the enum value goes to `reason`, keeping the row exactly
 *    what the UI could have produced, and the operator's VERBATIM wording is
 *    preserved on the candidate's `notes`. Approve/bank/flag reasons are not
 *    constrained by the picker, so those keep the operator's words directly.
 */
import { applyRatifyDecision, listRatifyQueue } from '@/db/repo'
import { getSqlite } from '@/db/connection'
import { REJECT_REASONS, type Decision, type RejectReason } from '@/db/enums'
import { loadEnvLocal, PipelineHalt } from '@/lib/env'

type Verdict = {
  n: number
  handle: string
  decision: Decision
  /** The operator's own words, verbatim. Never paraphrased. */
  verbatim: string | null
  /** Picker value for a reject. Null for every other decision. */
  reject?: RejectReason
}

/**
 * The verdicts as given, paired with the handle each position addressed in the
 * sheet that was sent. Where a reject's free text maps to more than one picker
 * value, the choice is noted — those are the ones worth a second look.
 */
const VERDICTS: Verdict[] = [
  { n: 1, handle: 'hunterstein_wk', decision: 'bank', verbatim: 'too big to cold DM, on-thesis otherwise' },
  { n: 2, handle: 'down_ethan', decision: 'approve', verbatim: null },
  { n: 3, handle: 'ace.dressler', decision: 'approve', verbatim: null },
  { n: 4, handle: 'santinoanzevino', decision: 'bank', verbatim: 'on hiatus per bio — revisit when active' },
  { n: 5, handle: 'benkumpofficial', decision: 'approve', verbatim: null },
  { n: 6, handle: 'chris.cxpa', decision: 'approve', verbatim: null },
  { n: 7, handle: 'koda.kammer', decision: 'bank', verbatim: 'right coach, wrong wave (size)' },
  { n: 8, handle: 'michaeljuliuss', decision: 'bank', verbatim: 'program seller, thin 1:1 signal' },
  // 'sponsored athlete, coaching is a sideline' — a sideline is not a coaching
  // business, so not-a-coach rather than not-selling.
  { n: 9, handle: 'austinalwayslifting', decision: 'reject', verbatim: 'sponsored athlete, coaching is a sideline', reject: 'not-a-coach' },
  { n: 10, handle: 'cruzbrahh', decision: 'flag', verbatim: 'on-thesis bio but activity unverifiable — recheck account' },
  { n: 11, handle: 'harryraftus', decision: 'reject', verbatim: 'agency-repped lifestyle influencer, not a coach', reject: 'not-a-coach' },
  { n: 12, handle: 'jacknormaan', decision: 'reject', verbatim: 'lifestyle creator, not a coach', reject: 'not-a-coach' },
  // JUDGEMENT CALL: 'coaches under a team brand, not independent' — he IS a
  // coach, so not-a-coach would be wrong; the disqualifier is independence,
  // which the picker has no word for.
  { n: 13, handle: 'brandonkennedyy', decision: 'reject', verbatim: 'coaches under a team brand, not independent', reject: 'other' },
  { n: 14, handle: 'heath.lifts', decision: 'bank', verbatim: 'agency-managed with real coaching site — wrong wave' },
  // JUDGEMENT CALL: 'out of market (Dubai), mega account' — two disqualifiers.
  // The picker has too-big but no out-of-market, and the operator led with the
  // market, so 'other' carries the primary reason honestly.
  { n: 15, handle: 'kylekuznik', decision: 'reject', verbatim: 'out of market (Dubai), mega account', reject: 'other' },
  { n: 16, handle: 'cmartyfit', decision: 'reject', verbatim: 'no visible online coaching offer', reject: 'not-selling' },
  // JUDGEMENT CALL: 'minor (16) — ineligible'. The picker has no age gate.
  { n: 17, handle: 'tommy_lifts10', decision: 'reject', verbatim: 'minor (16) — ineligible', reject: 'other' },
  { n: 18, handle: 'tyrounsaville1', decision: 'reject', verbatim: 'sponsored athlete, not a coach', reject: 'not-a-coach' },
  // JUDGEMENT CALL: 'gym founder / sponsored, not an online coach'. gym-floor
  // is for in-person trainers; the operator's stated disqualifier is that he
  // is not an online coach, so not-a-coach carries it.
  { n: 19, handle: 'nathannfrench', decision: 'reject', verbatim: 'gym founder / sponsored, not an online coach', reject: 'not-a-coach' },
  { n: 20, handle: 'teosworld_', decision: 'reject', verbatim: 'lifestyle creator, no coaching business', reject: 'not-a-coach' },
  { n: 21, handle: '_lucasaiello', decision: 'bank', verbatim: 'titled coach, no visible funnel — second look' },
  { n: 22, handle: 'brennancjennings', decision: 'reject', verbatim: 'sponsored creator, no coaching', reject: 'not-a-coach' },
  { n: 23, handle: 'conner_felts', decision: 'reject', verbatim: 'no coaching signal', reject: 'not-a-coach' },
  { n: 24, handle: 'jakeclayfit', decision: 'reject', verbatim: 'personal journey account, not selling', reject: 'not-selling' },
  { n: 25, handle: 'jet_ohler', decision: 'reject', verbatim: 'lifestyle account, not a coach', reject: 'not-a-coach' },
  { n: 26, handle: 'lukeewesttt', decision: 'reject', verbatim: 'sponsored creator, no coaching offer', reject: 'not-a-coach' },
  { n: 27, handle: 'aidengithens', decision: 'reject', verbatim: 'model/lifestyle, not a coach', reject: 'not-a-coach' },
  { n: 28, handle: 'hayeskrause', decision: 'reject', verbatim: 'lifestyle account, no coaching', reject: 'not-a-coach' },
  { n: 29, handle: 'matthewscriv', decision: 'reject', verbatim: 'trading creator, not fitness coaching', reject: 'not-a-coach' },
  { n: 30, handle: 'zachtaylorfit_', decision: 'reject', verbatim: 'talent-repped creator, not a coach', reject: 'not-a-coach' },
  // 'dormant, no coaching signal' — the picker's 'dead' is exactly dormant.
  { n: 31, handle: 'anderson_kaufman', decision: 'reject', verbatim: 'dormant, no coaching signal', reject: 'dead' },
  { n: 32, handle: 'kieron.hall', decision: 'reject', verbatim: 'no coaching signal', reject: 'not-a-coach' },
]

const flag = (n: string) => process.argv.includes(`--${n}`)

function main(): void {
  loadEnvLocal()
  const sqlite = getSqlite()

  // ── snapshot the queue BEFORE anything moves (guard 1) ─────────────────
  const calibration = new Set(
    (sqlite
      .prepare("SELECT handle FROM candidates WHERE notes LIKE '%score_context=calibration%'")
      .all() as { handle: string }[]).map((r) => r.handle),
  )
  const queue = listRatifyQueue().filter((c) => calibration.has(c.handle))

  if (queue.length !== VERDICTS.length) {
    throw new PipelineHalt(
      `The queue holds ${queue.length} calibration candidates but ${VERDICTS.length} verdicts were given. ` +
      'Refusing to apply positional verdicts to a queue that has changed shape.',
    )
  }

  // Every verdict's handle must match the position it was written against.
  const drift = VERDICTS
    .map((v, i) => (queue[i].handle === v.handle ? null : `#${v.n}: sheet @${v.handle} vs queue @${queue[i].handle}`))
    .filter((x): x is string => x !== null)
  if (drift.length) {
    throw new PipelineHalt(
      'QUEUE ORDER DRIFTED since the sheet was generated — verdicts would land on the wrong people:\n\n' +
      drift.map((d) => `  ${d}`).join('\n') +
      '\n\nNothing was applied. Regenerate the sheet and re-collect verdicts.',
    )
  }

  for (const v of VERDICTS) {
    if (v.decision === 'reject' && !v.reject) {
      throw new PipelineHalt(`#${v.n} @${v.handle} is a reject with no picker value.`)
    }
    if (v.reject && !(REJECT_REASONS as readonly string[]).includes(v.reject)) {
      throw new PipelineHalt(`#${v.n} @${v.handle} carries "${v.reject}", which is not a picker value.`)
    }
  }

  const byHandle = new Map(queue.map((c) => [c.handle, c]))
  const tally: Record<string, number> = { approve: 0, reject: 0, bank: 0, flag: 0 }

  if (flag('dry-run')) {
    for (const v of VERDICTS) {
      const c = byHandle.get(v.handle)!
      console.log(
        `  ${String(v.n).padStart(2)}. @${v.handle.padEnd(21)} ${c.tier} ${String(c.score).padStart(3)} -> ` +
        `${v.decision.toUpperCase().padEnd(7)} ${v.reject ? `[${v.reject}] ` : ''}${v.verbatim ?? ''}`,
      )
    }
    console.log('\n  DRY RUN — nothing applied.\n')
    return
  }

  console.log(`\nENTERING ${VERDICTS.length} VERDICTS via applyRatifyDecision\n`)

  const note = sqlite.prepare(
    `UPDATE candidates SET notes = CASE WHEN notes IS NULL OR notes = '' THEN ? ELSE notes || ' | ' || ? END,
            updated_at = ? WHERE id = ?`,
  )

  for (const v of VERDICTS) {
    const c = byHandle.get(v.handle)!
    // The picker value for a reject; the operator's own words otherwise.
    const reason = v.decision === 'reject' ? (v.reject as string) : v.verbatim
    const applied = applyRatifyDecision(c.id, v.decision, reason)
    tally[v.decision]++

    // The verbatim verdict, preserved regardless of what the picker could carry.
    if (v.verbatim) {
      note.run(`verdict: ${v.verbatim}`, `verdict: ${v.verbatim}`, new Date().toISOString(), c.id)
    }
    console.log(
      `  ${String(v.n).padStart(2)}. @${v.handle.padEnd(21)} ${c.tier} ${String(c.score).padStart(3)} -> ` +
      `${v.decision.toUpperCase().padEnd(7)}${applied.movedTo ? ` (${applied.movedTo})` : ' (stays sourced)'}` +
      `${v.reject ? `  [${v.reject}]` : ''}`,
    )
  }

  console.log(
    `\ndone — approve ${tally.approve} · reject ${tally.reject} · bank ${tally.bank} · flag ${tally.flag}\n`,
  )
}

main()
