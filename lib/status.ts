/**
 * PART 8.2 — THE STATUS MACHINE. Allowed transitions only, enforced.
 *
 *   sourced -(ratify y)-> qualified -> dmed -> replied -> call_booked ->
 *                         demo_given -> loi_sent -> signed
 *      |(ratify b)-> banked          |`-------- declined (they said no, any stage)
 *      |(ratify n)-> rejected        `-> no_response (1 follow-up + 7 quiet days)
 *
 * Re-entry edges (ratified in A1), manual via the drawer only, never automated:
 *   no_response -> replied    a ghost who answers late; the funnel resumes
 *   banked ------> qualified  wave-three activation of banked inventory
 *
 * Ratify-undo edges (Part VII `u`, ratified A2): the queue's undo returns a
 * mis-keyed candidate to `sourced`.
 *   qualified -> sourced · rejected -> sourced · banked -> sourced
 * Ratify-surface only, immediately after the erroneous keystroke — the drawer
 * never offers them, so undo can never become a general demotion path.
 *
 * `rejected` = WE disqualified.  `declined` = THEY said no.  Never conflate.
 *
 * This object is the single source of truth: db/enforcement.ts compiles it into
 * a SQLite trigger, so the graph holds for the UI, scripts, and raw SQL alike.
 */
import type { Status } from '@/db/enums'
import { STATUSES } from '@/db/enums'

export const TRANSITIONS: Record<Status, readonly Status[]> = {
  // Ratify queue is the only door out of `sourced` (Law 10).
  sourced: ['qualified', 'banked', 'rejected'],
  // "declined (they said no, any stage)" — every live funnel stage can decline.
  // `sourced` is the ratify-undo edge (Part VII `u`), not a demotion path.
  qualified: ['dmed', 'declined', 'sourced'],
  dmed: ['replied', 'no_response', 'declined'],
  replied: ['call_booked', 'declined'],
  call_booked: ['demo_given', 'declined'],
  demo_given: ['loi_sent', 'declined'],
  loi_sent: ['signed', 'declined'],
  // Re-entry into the live funnel. Ratified in A1: without these, a ghost who
  // answers late has no legal move and banked inventory is dead stock (Law 7).
  // Both are manual, drawer-only moves — nothing automated may take them.
  no_response: ['replied'],
  banked: ['qualified', 'sourced'],
  // Terminal for the funnel, except the ratify-undo edge (Part VII `u`).
  rejected: ['sourced'],
  // Terminal states.
  signed: [],
  declined: [],
}

/**
 * Edges reserved for the ratify queue's `u` (Part VII). Legal in the graph —
 * the DB trigger must allow the undo — but never OFFERED anywhere else: the
 * drawer showing "→ Sourced" on a rejected candidate would turn an undo
 * mechanism into a general demotion path.
 */
export const RATIFY_UNDO_EDGES: ReadonlyArray<readonly [Status, Status]> = [
  ['qualified', 'sourced'],
  ['rejected', 'sourced'],
  ['banked', 'sourced'],
]

export function isRatifyUndoEdge(from: Status, to: Status): boolean {
  return RATIFY_UNDO_EDGES.some(([f, t]) => f === from && t === to)
}

/** What the pipeline drawer offers: the graph minus the ratify-undo edges. */
export function drawerTransitions(from: Status): readonly Status[] {
  return TRANSITIONS[from].filter((to) => !isRatifyUndoEdge(from, to))
}

/** Terminal AS SEEN FROM THE DRAWER — `rejected` keeps only its undo edge. */
export const TERMINAL_STATUSES: readonly Status[] =
  STATUSES.filter((s) => drawerTransitions(s).length === 0)

export function canTransition(from: Status, to: Status): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false
}

export function assertTransition(from: Status, to: Status): void {
  if (from === to) throw new Error(`Already ${from}.`)
  if (!canTransition(from, to)) {
    const legal = TRANSITIONS[from]
    throw new Error(
      legal.length
        ? `Illegal transition ${from} -> ${to} (Part 8.2). Legal from ${from}: ${legal.join(', ')}.`
        : `${from} is terminal (Part 8.2): no transitions out.`,
    )
  }
}

/**
 * Default /pipeline sort key. INVENTION (flagged): the blueprint says
 * "status-priority then score desc" but does not order the statuses.
 * Ordered by what needs Conner's hands soonest: live replies first, then
 * in-flight deals, then ready-to-send, then waiting, then the ratify backlog,
 * then terminal states.
 */
export const STATUS_PRIORITY: Record<Status, number> = {
  replied: 1,
  call_booked: 2,
  demo_given: 3,
  loi_sent: 4,
  qualified: 5,
  dmed: 6,
  sourced: 7,
  signed: 8,
  no_response: 9,
  banked: 10,
  declined: 11,
  rejected: 12,
}

/** The funnel proper — the stage-to-stage conversion strip on /pipeline. */
export const FUNNEL_ORDER: readonly Status[] = [
  'sourced', 'qualified', 'dmed', 'replied', 'call_booked', 'demo_given', 'loi_sent', 'signed',
]

/** Off-funnel exits, shown as a second row of counts. */
export const OFF_FUNNEL: readonly Status[] = ['rejected', 'banked', 'no_response', 'declined']

export const STATUS_LABELS: Record<Status, string> = {
  sourced: 'Sourced',
  qualified: 'Qualified',
  dmed: 'DMed',
  replied: 'Replied',
  no_response: 'No response',
  call_booked: 'Call booked',
  demo_given: 'Demo given',
  loi_sent: 'LOI sent',
  signed: 'Signed',
  declined: 'Declined',
  rejected: 'Rejected',
  banked: 'Banked',
}
