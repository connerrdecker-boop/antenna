'use server'
/**
 * Ratify-queue mutations (Part VII). Every keystroke lands here; every input
 * is re-validated server-side — the client is untrusted even on localhost.
 */
import { revalidatePath } from 'next/cache'
import { DECISIONS, REJECT_REASONS, type Decision } from '@/db/enums'
import { applyRatifyDecision, undoRatifyDecision, type RatifyApplied } from '@/db/repo'
import { writeStateExportSafely } from '@/lib/stateExport'

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string }

const fail = (e: unknown): { ok: false; error: string } => ({
  ok: false,
  error: e instanceof Error ? e.message : String(e),
})

const asId = (v: unknown): number => {
  const n = Number(v)
  if (!Number.isInteger(n) || n <= 0) throw new Error('invalid id')
  return n
}

export async function rate(
  candidateId: number,
  decision: string,
  reason?: string,
): Promise<ActionResult<RatifyApplied>> {
  try {
    if (!DECISIONS.includes(decision as Decision)) throw new Error(`unknown decision "${decision}"`)
    const cleanReason = reason?.trim() || null
    if (decision === 'reject' && cleanReason && !(REJECT_REASONS as readonly string[]).includes(cleanReason)) {
      throw new Error(`unknown reject reason "${cleanReason}"`)
    }
    const applied = applyRatifyDecision(asId(candidateId), decision as Decision, cleanReason)
    // WRITE-THROUGH (ratified). The operator's ratify hour is the highest-value
    // data this system will ever hold and the only data no amount of money can
    // reproduce — so it gets zero-window durability, not milestone durability.
    // The snapshot is current before this action returns; it never throws
    // (Law 7).
    writeStateExportSafely()
    revalidatePath('/ratify')
    revalidatePath('/pipeline')
    return { ok: true, data: applied }
  } catch (e) {
    return fail(e)
  }
}

export async function undo(candidateId: number, ratificationId: number): Promise<ActionResult> {
  try {
    undoRatifyDecision(asId(candidateId), asId(ratificationId))
    // An undo is a decision too: without this, the withdrawn ratification
    // stays in the snapshot and walks back in on the next restore.
    writeStateExportSafely()
    revalidatePath('/ratify')
    revalidatePath('/pipeline')
    return { ok: true, data: null }
  } catch (e) {
    return fail(e)
  }
}
