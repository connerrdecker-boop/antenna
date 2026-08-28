/**
 * The data access layer. Reads use Drizzle; writes go through small
 * transactional functions so the app can never leave the DB half-updated.
 *
 * Note the division of labour with db/enforcement.ts: the triggers are the
 * GUARANTEE (they bind every writer, including raw SQL); the checks here are
 * for ERROR QUALITY (they fail early with a message a human can act on).
 */
import { and, desc, eq, sql } from 'drizzle-orm'
import { getDb, getSqlite } from './connection'
import type { Decision, LoiTier, Metro, Status, Tier } from './enums'
import { STATUSES } from './enums'
import { parseJsonArray, parseJsonObject, type Extracted } from './json'
import { candidates, outreachLog, ratifications, statusHistory } from './schema'
import { igUrlFor, normalizeHandle, normalizeLinkUrl } from '@/lib/handle'
import { isForgotten } from '@/lib/tombstones'
import { assertTransition, drawerTransitions, FUNNEL_ORDER, STATUS_PRIORITY } from '@/lib/status'

export const nowIso = () => new Date().toISOString()

/** Status-priority sort key, compiled from lib/status.ts (Part 8.1 default sort). */
const STATUS_RANK = sql.raw(
  `CASE candidates.status ${STATUSES.map((s) => `WHEN '${s}' THEN ${STATUS_PRIORITY[s]}`).join(' ')} ELSE 99 END`,
)

/**
 * The `at` of a candidate's most recent status_history row — drives days-in-status.
 *
 * The outer column is written out as `candidates.id` rather than interpolated as
 * ${candidates.id}: Drizzle renders an interpolated column UNQUALIFIED, and a bare
 * `id` inside this subquery would bind to status_history.id, silently correlating
 * every row to the same wrong history row. npm run check asserts this stays right.
 */
const STATUS_SINCE = sql<string>`(
  SELECT sh.at FROM status_history sh WHERE sh.candidate_id = candidates.id
  ORDER BY sh.id DESC LIMIT 1
)`

export function daysSince(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.floor((now - t) / 86_400_000))
}

// ---------------------------------------------------------------- reads

export type PipelineFilters = {
  status?: Status | 'all'
  tier?: Tier | 'all'
  metro?: Metro | 'all'
  source?: string | 'all'
}

export type PipelineRow = {
  id: number
  handle: string
  tier: Tier | null
  score: number | null
  metro: Metro | null
  followerCount: number | null
  status: Status
  statusSince: string | null
  daysInStatus: number | null
  nextActionDate: string | null
  followupCount: number
  source: string
  igUrl: string | null
  linkUrl: string | null
}

export function listCandidates(filters: PipelineFilters = {}): PipelineRow[] {
  const where = []
  if (filters.status && filters.status !== 'all') where.push(eq(candidates.status, filters.status))
  if (filters.tier && filters.tier !== 'all') where.push(eq(candidates.tier, filters.tier))
  if (filters.metro && filters.metro !== 'all') where.push(eq(candidates.metro, filters.metro))
  if (filters.source && filters.source !== 'all') where.push(eq(candidates.source, filters.source))

  const rows = getDb()
    .select({
      id: candidates.id,
      handle: candidates.handle,
      tier: candidates.tier,
      score: candidates.score,
      metro: candidates.metro,
      followerCount: candidates.followerCount,
      status: candidates.status,
      nextActionDate: candidates.nextActionDate,
      followupCount: candidates.followupCount,
      source: candidates.source,
      igUrl: candidates.igUrl,
      linkUrl: candidates.linkUrl,
      statusSince: STATUS_SINCE,
    })
    .from(candidates)
    .where(where.length ? and(...where) : undefined)
    // Part 8.1: "Default sort: status-priority then score desc."
    .orderBy(STATUS_RANK, desc(candidates.score), candidates.handle)
    .all()

  const now = Date.now()
  return rows.map((r) => ({ ...r, daysInStatus: daysSince(r.statusSince, now) }))
}

/** Distinct sources present in the DB — populates the /pipeline source filter. */
export function listSources(): string[] {
  return getDb()
    .selectDistinct({ source: candidates.source })
    .from(candidates)
    .orderBy(candidates.source)
    .all()
    .map((r) => r.source)
}

export type CandidateDetail = {
  candidate: typeof candidates.$inferSelect
  evidence: string[]
  stackSignals: string[]
  extracted: Extracted | null
  history: (typeof statusHistory.$inferSelect)[]
  outreach: (typeof outreachLog.$inferSelect)[]
  ratifications: (typeof ratifications.$inferSelect)[]
  legalTransitions: readonly Status[]
  daysInStatus: number | null
  /** Secondary dedupe (Part III): others sharing this link page. Flag, never merge. */
  linkTwins: { id: number; handle: string }[]
}

export function getCandidateDetail(id: number): CandidateDetail | null {
  const db = getDb()
  const candidate = db.select().from(candidates).where(eq(candidates.id, id)).get()
  if (!candidate) return null

  const history = db.select().from(statusHistory)
    .where(eq(statusHistory.candidateId, id)).orderBy(desc(statusHistory.id)).all()
  const outreach = db.select().from(outreachLog)
    .where(eq(outreachLog.candidateId, id)).orderBy(desc(outreachLog.id)).all()
  const rats = db.select().from(ratifications)
    .where(eq(ratifications.candidateId, id)).orderBy(desc(ratifications.id)).all()

  const norm = normalizeLinkUrl(candidate.linkUrl)
  const linkTwins = norm
    ? db.select({ id: candidates.id, handle: candidates.handle, linkUrl: candidates.linkUrl })
        .from(candidates).all()
        .filter((c) => c.id !== id && normalizeLinkUrl(c.linkUrl) === norm)
        .map(({ id: tid, handle }) => ({ id: tid, handle }))
    : []

  return {
    candidate,
    evidence: parseJsonArray(candidate.evidence),
    stackSignals: parseJsonArray(candidate.stackSignals),
    extracted: parseJsonObject<Extracted>(candidate.extracted),
    history,
    outreach,
    ratifications: rats,
    // Drawer moves only — the ratify-undo edges belong to the queue's `u` key.
    legalTransitions: drawerTransitions(candidate.status),
    daysInStatus: daysSince(history[0]?.at ?? candidate.firstSeen),
    linkTwins,
  }
}

export type FunnelStats = {
  /** Candidates sitting at each status right now. */
  current: Record<Status, number>
  /** Candidates that EVER reached each status, from status_history. */
  everReached: Record<Status, number>
  /** Stage-to-stage conversion % along FUNNEL_ORDER (index i = i -> i+1). */
  conversions: { from: Status; to: Status; pct: number | null }[]
  total: number
}

export function funnelStats(): FunnelStats {
  const db = getDb()
  const current = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>
  for (const r of db.select({ status: candidates.status, n: sql<number>`count(*)` })
    .from(candidates).groupBy(candidates.status).all()) {
    current[r.status] = Number(r.n)
  }

  const everReached = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>
  for (const r of db.select({
    status: statusHistory.toStatus,
    n: sql<number>`count(distinct ${statusHistory.candidateId})`,
  }).from(statusHistory).groupBy(statusHistory.toStatus).all()) {
    everReached[r.status] = Number(r.n)
  }

  const conversions = FUNNEL_ORDER.slice(0, -1).map((from, i) => {
    const to = FUNNEL_ORDER[i + 1]
    const denom = everReached[from]
    return { from, to, pct: denom > 0 ? (everReached[to] / denom) * 100 : null }
  })

  const total = Object.values(current).reduce((a, b) => a + b, 0)
  return { current, everReached, conversions, total }
}

// ---------------------------------------------------------------- writes

export type AddOutcome =
  | { input: string; kind: 'added'; id: number; handle: string }
  | { input: string; kind: 'existing'; id: number; handle: string; status: Status }
  | { input: string; kind: 'invalid'; reason: string }

/**
 * /add (Part 4d). Dedupe on handle: an existing candidate is SURFACED,
 * never duplicated, never silently overwritten.
 */
export function addCandidates(inputs: string[], source = 'manual', sourceDetail?: string): AddOutcome[] {
  const sqlite = getSqlite()
  const db = getDb()
  const at = nowIso()
  const seenThisBatch = new Map<string, { id: number; status: Status }>()

  const insert = sqlite.prepare(
    `INSERT INTO candidates (handle, ig_url, source, source_detail, first_seen, status, followup_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'sourced', 0, ?, ?)`,
  )

  const run = sqlite.transaction((): AddOutcome[] =>
    inputs.map((raw) => {
      const input = raw.trim()
      if (!input) return { input, kind: 'invalid', reason: 'empty' } as const

      const handle = normalizeHandle(input)
      if (!handle) {
        return { input, kind: 'invalid', reason: 'not a recognizable Instagram handle or profile URL' } as const
      }

      // Law 5: a forgotten handle stays forgotten. Erasure that only clears
      // the row is undone by the next harvest, which would re-collect the same
      // person from the same query — so the tombstone is checked at the door
      // every candidate comes through, restore and re-harvest included.
      if (isForgotten(handle)) {
        return { input, kind: 'invalid', reason: 'forgotten at this person\'s request (Law 5) — remove the tombstone deliberately if this is wrong' } as const
      }

      // The same person twice in one paste is not two additions. Surface the
      // row we just created rather than reporting a second "added".
      const dupeInBatch = seenThisBatch.get(handle)
      if (dupeInBatch) {
        return { input, kind: 'existing', id: dupeInBatch.id, handle, status: dupeInBatch.status } as const
      }

      const existing = db
        .select({ id: candidates.id, handle: candidates.handle, status: candidates.status })
        .from(candidates).where(eq(candidates.handle, handle)).get()
      if (existing) {
        seenThisBatch.set(handle, { id: existing.id, status: existing.status })
        return { input, kind: 'existing', ...existing } as const
      }

      const info = insert.run(handle, igUrlFor(handle), source, sourceDetail ?? null, at, at, at)
      const id = Number(info.lastInsertRowid)
      seenThisBatch.set(handle, { id, status: 'sourced' })
      return { input, kind: 'added', id, handle } as const
    }),
  )
  return run()
}

export type TransitionOpts = {
  note?: string | null
  /** Backdate the history row (seed/import only). Defaults to the trigger's now. */
  at?: string
  /** Required when moving to `signed` unless the candidate already carries one. */
  loiTier?: LoiTier | null
}

/**
 * The ONLY status writer in the app. Validates the Part 8.2 graph, applies the
 * change, and lets the trigger write status_history; the note (and, for
 * seeding, the timestamp) are attached to that row in the same transaction.
 */
export function transitionStatus(id: number, to: Status, opts: TransitionOpts = {}): void {
  const sqlite = getSqlite()
  const run = sqlite.transaction(() => {
    const row = sqlite.prepare('SELECT id, status, loi_tier FROM candidates WHERE id = ?').get(id) as
      | { id: number; status: Status; loi_tier: LoiTier | null }
      | undefined
    if (!row) throw new Error(`candidate ${id} not found`)

    assertTransition(row.status, to)

    const loiTier = opts.loiTier ?? row.loi_tier
    if (to === 'signed' && !loiTier) {
      throw new Error('signed requires loi_tier (Part 8.2): T1 signature · T2 beta commitment · T3 deposit')
    }

    const at = opts.at ?? nowIso()
    sqlite
      .prepare('UPDATE candidates SET status = ?, loi_tier = ?, updated_at = ? WHERE id = ?')
      .run(to, loiTier ?? null, at, id)

    // The AFTER UPDATE trigger just wrote this row; enrich it with the note and,
    // when backdating, the caller's timestamp.
    //
    // Verify the row actually DESCRIBES this hop before touching it. Checking
    // only that some row exists is useless — the genesis row guarantees that —
    // so if the trigger were ever missing we would silently overwrite the
    // PREVIOUS transition's note and timestamp and report success.
    const hist = sqlite
      .prepare('SELECT id, from_status, to_status FROM status_history WHERE candidate_id = ? ORDER BY id DESC LIMIT 1')
      .get(id) as { id: number; from_status: Status | null; to_status: Status } | undefined
    if (!hist || hist.from_status !== row.status || hist.to_status !== to) {
      throw new Error(
        'status_history row was not written for this transition — enforcement triggers are missing. Run npm run migrate.',
      )
    }
    sqlite
      .prepare('UPDATE status_history SET note = ?, at = ? WHERE id = ?')
      .run(opts.note ?? null, at, hist.id)
  })
  run()
}

/** Part VII: every ratify keystroke writes a ratifications row (few-shot fuel). */
export function recordRatification(
  candidateId: number,
  decision: Decision,
  reason: string | null,
  at: string = nowIso(),
): void {
  getDb().insert(ratifications).values({ candidateId, decision, reason, at }).run()
}

/**
 * Part 8.3: log what was actually sent/received — and KEEP THE FOLLOW-UP
 * COUNTER TRUE.
 *
 * The Part 8.2 policy is "exactly ONE follow-up per candidate, 5-7 days after
 * the DM, then no_response. Never a third touch." Enforcement lived in the
 * candidates_guard trigger, which refuses followup_count > FOLLOWUP
 * .maxPerCandidate — but nothing in the tree ever incremented the column, so
 * the guard bound a counter that never counted and the policy was decorative.
 *
 * The rule, stated once and derived here: outbound #1 is the DM, so
 * followup_count = max(0, outbound_count - 1). Recomputed from the log rather
 * than incremented blindly, so the counter cannot drift from the record it
 * summarises — and a third outbound message is refused by the trigger, at the
 * database, for every writer.
 */
export function logOutreach(
  candidateId: number,
  direction: 'out' | 'in',
  text: string | null,
  at: string = nowIso(),
): void {
  const sqlite = getSqlite()
  const run = sqlite.transaction(() => {
    getDb().insert(outreachLog).values({ candidateId, direction, text, at }).run()
    if (direction !== 'out') return
    const { c } = sqlite
      .prepare("SELECT count(*) c FROM outreach_log WHERE candidate_id = ? AND direction = 'out'")
      .get(candidateId) as { c: number }
    // updated_at is set explicitly so candidates_touch_updated_at stays quiet;
    // this is a real edit, and it should carry this moment, not the trigger's.
    sqlite
      .prepare('UPDATE candidates SET followup_count = ?, updated_at = ? WHERE id = ?')
      .run(Math.max(0, c - 1), nowIso(), candidateId)
  })
  run()
}

export function updateNotes(id: number, notes: string | null): void {
  getDb().update(candidates)
    .set({ notes: notes?.trim() ? notes : null, updatedAt: nowIso() })
    .where(eq(candidates.id, id)).run()
}

export function setNextActionDate(id: number, date: string | null): void {
  getDb().update(candidates)
    .set({ nextActionDate: date?.trim() ? date : null, updatedAt: nowIso() })
    .where(eq(candidates.id, id)).run()
}

// ---------------------------------------------------------------- ratify (Part VII)

export type RatifyCard = {
  id: number
  handle: string
  igUrl: string | null
  name: string | null
  tier: Tier
  score: number | null
  preScore: number | null
  followerCount: number | null
  metro: Metro | null
  metroConfidence: number | null
  bio: string | null
  hookDraft: string | null
  evidence: string[]
  stackSignals: string[]
  extracted: Extracted | null
  linkUrl: string | null
  linkDomain: string | null
  source: string
  /** Latest flag note, when the operator pressed f on this one earlier. */
  flagged: boolean
}

/**
 * The queue: everything scored and still sourced, best first. X-tier rows ride
 * at the back — they need a human `n` to become `rejected`, or they clog
 * `sourced` forever; blasting through them is fast by design.
 */
export function listRatifyQueue(): RatifyCard[] {
  const sqlite = getSqlite()
  const rows = sqlite
    .prepare(
      `SELECT c.id, c.handle, c.ig_url, c.name, c.tier, c.score, c.pre_score,
              c.follower_count, c.metro, c.metro_confidence, c.bio, c.hook_draft,
              c.evidence, c.stack_signals, c.extracted, c.link_url, c.link_domain, c.source,
              EXISTS(
                SELECT 1 FROM ratifications r
                WHERE r.candidate_id = c.id AND r.decision = 'flag'
              ) AS flagged
       FROM candidates c
       WHERE c.status = 'sourced' AND c.tier IS NOT NULL AND c.score_failed = 0
       ORDER BY CASE c.tier WHEN 'A' THEN 0 WHEN 'B' THEN 1 WHEN 'C' THEN 2 ELSE 3 END,
                c.score DESC, c.handle`,
    )
    .all() as Array<Record<string, unknown>>

  return rows.map((r) => ({
    id: r.id as number,
    handle: r.handle as string,
    igUrl: r.ig_url as string | null,
    name: r.name as string | null,
    tier: r.tier as Tier,
    score: r.score as number | null,
    preScore: r.pre_score as number | null,
    followerCount: r.follower_count as number | null,
    metro: r.metro as Metro | null,
    metroConfidence: r.metro_confidence as number | null,
    bio: r.bio as string | null,
    hookDraft: r.hook_draft as string | null,
    evidence: parseJsonArray(r.evidence as string | null),
    stackSignals: parseJsonArray(r.stack_signals as string | null),
    extracted: parseJsonObject<Extracted>(r.extracted as string | null),
    linkUrl: r.link_url as string | null,
    linkDomain: r.link_domain as string | null,
    source: r.source as string,
    flagged: Boolean(r.flagged),
  }))
}

/** Where each ratify decision sends a candidate (Part VII / Part 8.2). */
const DECISION_TARGET: Record<Decision, Status | null> = {
  approve: 'qualified',
  reject: 'rejected',
  bank: 'banked',
  flag: null, // a closer look — the candidate stays in the queue
}

export type RatifyApplied = { ratificationId: number; movedTo: Status | null }

/**
 * One keystroke = one ratifications row (the training data, Part 6.5) + the
 * status move the graph prescribes — atomically. A crash between the two would
 * otherwise leave a decision that trains the scorer but never happened.
 */
export function applyRatifyDecision(
  candidateId: number,
  decision: Decision,
  reason: string | null,
): RatifyApplied {
  const sqlite = getSqlite()
  const run = sqlite.transaction((): RatifyApplied => {
    const row = sqlite
      .prepare("SELECT id, status, tier FROM candidates WHERE id = ?")
      .get(candidateId) as { id: number; status: Status; tier: Tier | null } | undefined
    if (!row) throw new Error(`candidate ${candidateId} not found`)
    if (row.status !== 'sourced') {
      throw new Error(`only sourced candidates are in the queue — this one is ${row.status}`)
    }
    if (row.tier === null) throw new Error('unscored candidates cannot be ratified')
    if (decision === 'reject' && !reason) {
      throw new Error('reject needs a reason — it is the training signal (Part 6.5)')
    }

    const at = nowIso()
    const info = sqlite
      .prepare('INSERT INTO ratifications (candidate_id, decision, reason, at) VALUES (?, ?, ?, ?)')
      .run(candidateId, decision, reason, at)

    const target = DECISION_TARGET[decision]
    if (target) transitionStatus(candidateId, target, { note: `ratify ${decision}${reason ? `: ${reason}` : ''}` })
    return { ratificationId: Number(info.lastInsertRowid), movedTo: target }
  })
  return run()
}

/**
 * Part VII `u` — undo last. Two effects, both deliberate:
 *   1. The erroneous ratification row is DELETED. The table is the few-shot
 *      training data (Part 6.5); a mis-keystroke left in place would train the
 *      scorer on a decision Conner never made.
 *   2. The status move is reverted along the ratify-undo edge, which writes a
 *      status_history row like every transition — the history keeps the truth
 *      that the round-trip happened.
 * Guarded: only the candidate's NEWEST ratification can be undone, and only
 * while the status still matches what that decision produced.
 */
export function undoRatifyDecision(candidateId: number, ratificationId: number): void {
  const sqlite = getSqlite()
  const run = sqlite.transaction(() => {
    const rat = sqlite
      .prepare('SELECT id, decision FROM ratifications WHERE id = ? AND candidate_id = ?')
      .get(ratificationId, candidateId) as { id: number; decision: Decision } | undefined
    if (!rat) throw new Error('that ratification no longer exists')

    const newest = sqlite
      .prepare('SELECT id FROM ratifications WHERE candidate_id = ? ORDER BY id DESC LIMIT 1')
      .get(candidateId) as { id: number }
    if (newest.id !== rat.id) {
      throw new Error('only the most recent decision on a candidate can be undone')
    }

    const target = DECISION_TARGET[rat.decision]
    if (target) {
      const row = sqlite.prepare('SELECT status FROM candidates WHERE id = ?').get(candidateId) as
        | { status: Status }
        | undefined
      if (!row) throw new Error(`candidate ${candidateId} not found`)
      if (row.status !== target) {
        throw new Error(
          `cannot undo: the candidate has moved on to ${row.status} since that decision`,
        )
      }
      transitionStatus(candidateId, 'sourced', { note: `ratify undo (${rat.decision})` })
    }
    sqlite.prepare('DELETE FROM ratifications WHERE id = ?').run(rat.id)
  })
  run()
}
