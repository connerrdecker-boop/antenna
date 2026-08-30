/**
 * `npm run verdicts:reasons` — attach the operator's words to the four
 * approvals, which were entered as a bare `y`.
 *
 * WHY THIS IS NOT AN UPDATE STATEMENT. `ratifications` is the Part 6.5
 * training data, and Part 2.2 says never hand-edit the database. So each
 * approval goes back out through undoRatifyDecision() and in again through
 * applyRatifyDecision() with the reason attached — the same two doors the
 * `u` key and the `y` key use. That leaves the round trip visible in
 * status_history (qualified → sourced → qualified), which is the honest
 * record: the decision genuinely was withdrawn and re-made.
 *
 * The reason matters more here than anywhere else in the table. buildFewShotBlock()
 * renders it verbatim as `operator's reason:` into the scorer's system prompt,
 * and approvals are HALF that block. Four approvals with no reason meant the
 * scorer was being shown what Conner said yes to without being told why.
 */
import { applyRatifyDecision, undoRatifyDecision } from '@/db/repo'
import { getSqlite } from '@/db/connection'
import { loadEnvLocal, PipelineHalt } from '@/lib/env'

/** The operator's words, verbatim. Not paraphrased, not tidied. */
const REASONS: { handle: string; reason: string }[] = [
  { handle: 'down_ethan', reason: 'real working coach — apply funnel, client proof, clear niche' },
  { handle: 'ace.dressler', reason: 'clean solo 1:1 operation, DM-word funnel, right size' },
  { handle: 'benkumpofficial', reason: 'sharp niche (men 35+), DM funnel plus free system' },
  { handle: 'chris.cxpa', reason: 'founder energy, own coaching brand, 50+ transformations' },
]

function main(): void {
  loadEnvLocal()
  const sqlite = getSqlite()

  console.log(`\nAMENDING ${REASONS.length} APPROVAL REASONS (undo → re-apply, never UPDATE)\n`)

  for (const { handle, reason } of REASONS) {
    const row = sqlite
      .prepare('SELECT id, status FROM candidates WHERE handle = ?')
      .get(handle) as { id: number; status: string } | undefined
    if (!row) throw new PipelineHalt(`@${handle} is not in this database.`)

    const rat = sqlite
      .prepare(
        "SELECT id, decision, reason FROM ratifications WHERE candidate_id = ? ORDER BY id DESC LIMIT 1",
      )
      .get(row.id) as { id: number; decision: string; reason: string | null } | undefined
    if (!rat) throw new PipelineHalt(`@${handle} has no ratification to amend.`)
    if (rat.decision !== 'approve') {
      throw new PipelineHalt(`@${handle}'s newest decision is "${rat.decision}", not an approve. Refusing.`)
    }
    if (rat.reason) {
      console.log(`  @${handle.padEnd(18)} already carries a reason — left alone`)
      continue
    }

    undoRatifyDecision(row.id, rat.id)
    applyRatifyDecision(row.id, 'approve', reason)
    console.log(`  @${handle.padEnd(18)} approve · "${reason}"`)
  }

  const missing = (sqlite
    .prepare(
      "SELECT count(*) c FROM ratifications WHERE decision = 'approve' AND (reason IS NULL OR trim(reason) = '')",
    )
    .get() as { c: number }).c
  console.log(`\n  approvals still carrying no reason: ${missing}\n`)
}

main()
