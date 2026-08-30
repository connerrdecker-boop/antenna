/**
 * `npm run ratify:one -- --handle=x --decision=y --reason="..."` — enter ONE
 * verdict through the real ratification path.
 *
 * The batch door (scripts/enter-verdicts.ts) exists for a ratify pass; this is
 * for the single decision that arrives afterwards — a flagged profile the
 * operator went and checked by hand, say. Same door either way:
 * applyRatifyDecision(), so the ratifications row, the Part 8.2 transition,
 * the Law 10 gate and the few-shot block all see it identically.
 *
 * Reject reasons are validated against the Part VII picker, exactly as
 * app/ratify/actions.ts validates them, so this CLI cannot write a row the
 * keyboard could not have produced.
 */
import { applyRatifyDecision, undoRatifyDecision } from '@/db/repo'
import { getSqlite } from '@/db/connection'
import { DECISIONS, REJECT_REASONS, type Decision } from '@/db/enums'
import { loadEnvLocal, PipelineHalt } from '@/lib/env'
import { normalizeHandle } from '@/lib/handle'

const arg = (n: string): string | null =>
  process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? null

function main(): void {
  loadEnvLocal()

  const rawHandle = arg('handle')
  const decision = arg('decision')
  const reason = arg('reason')?.trim() || null

  if (!rawHandle || !decision) {
    throw new PipelineHalt('usage: npm run ratify:one -- --handle=x --decision=approve|reject|bank|flag [--reason="..."]')
  }
  if (!DECISIONS.includes(decision as Decision)) {
    throw new PipelineHalt(`unknown decision "${decision}" — one of ${DECISIONS.join(', ')}`)
  }
  if (decision === 'reject' && reason && !(REJECT_REASONS as readonly string[]).includes(reason)) {
    throw new PipelineHalt(
      `"${reason}" is not a Part VII picker value. Rejects take one of: ${REJECT_REASONS.join(', ')}`,
    )
  }

  const handle = normalizeHandle(rawHandle)
  if (!handle) throw new PipelineHalt(`"${rawHandle}" is not a usable handle.`)

  const sqlite = getSqlite()
  const row = sqlite
    .prepare('SELECT id, status, tier, score FROM candidates WHERE handle = ?')
    .get(handle) as { id: number; status: string; tier: string | null; score: number | null } | undefined
  if (!row) throw new PipelineHalt(`@${handle} is not in this database.`)

  // CHANGING a decision, not making a first one. applyRatifyDecision only
  // accepts `sourced` rows — the queue door — so a candidate the operator has
  // already ruled on must come back through the undo edge before the new
  // verdict can be applied. That is the same two keystrokes /ratify uses (`u`
  // then the new letter), and it leaves the reversal visible in
  // status_history rather than silently rewriting the original decision.
  if (process.argv.includes('--undo-first')) {
    const prev = sqlite
      .prepare('SELECT id, decision FROM ratifications WHERE candidate_id = ? ORDER BY at DESC, id DESC LIMIT 1')
      .get(row.id) as { id: number; decision: string } | undefined
    if (!prev) throw new PipelineHalt(`@${handle} has no decision to undo.`)
    undoRatifyDecision(row.id, prev.id)
    console.log(`\n  undid the previous decision (${prev.decision}) — back to sourced`)
  }

  const applied = applyRatifyDecision(row.id, decision as Decision, reason)
  console.log(
    `\n  @${handle} ${row.tier ?? '—'} ${row.score ?? ''} -> ${decision.toUpperCase()}` +
    `${applied.movedTo ? ` (${applied.movedTo})` : ' (stays sourced)'}` +
    `${reason ? `\n  reason: "${reason}"` : ''}\n`,
  )
}

main()
