/**
 * DB-STATE INVARIANTS — the assertions that are a pure function of a database.
 *
 * Extracted from scripts/check.ts so a RESTORE can run them INSIDE its
 * transaction and roll back on red (ratified). check.ts could never be
 * imported for that: it has no exports, opens the live database at module
 * scope, and calls process.exit — so importing it would audit the wrong
 * database and then kill the caller mid-transaction.
 *
 * WHAT LIVES HERE vs WHAT STAYS IN check.ts
 * Everything here answers "is the DATA sound?" and takes an explicit handle,
 * so it can be pointed at a half-built restore. What stays in check.ts is
 * everything that answers "is the CODE faithful to canon?" — prompt fidelity,
 * ratified-config gates, provider halts, and above all the Part 8.2
 * transition-LEGALITY check, which compares the database against a
 * hand-transcribed CANON_TRANSITIONS. That transcription is deliberately not
 * importable: a legality check that read the graph from lib/status.ts could
 * only ever agree with it. Restore does not need it either — every hop it
 * replays goes through transitionStatus and the DB trigger, both of which
 * refuse an illegal hop outright.
 */
import type BetterSqlite3 from 'better-sqlite3'
import { CAPS, FOLLOWUP, PRESCORE_THRESHOLD } from '@/config/limits'
import { LOI_TIERS, SPEND_CATEGORIES, type Status } from '@/db/enums'

export type AssertionResult = { label: string; ok: boolean; detail?: string }

export function runDbAssertions(sqlite: BetterSqlite3.Database): AssertionResult[] {
  const out: AssertionResult[] = []
  const q = <T>(sql: string, ...a: unknown[]): T[] => sqlite.prepare(sql).all(...a) as T[]
  const one = <T>(sql: string, ...a: unknown[]): T => sqlite.prepare(sql).get(...a) as T
  const add = (label: string, ok: boolean, detail = '') => { out.push({ label, ok, detail }) }

  // ── identity ────────────────────────────────────────────────────────────
  const dupes = q<{ handle: string; c: number }>(
    'SELECT handle, count(*) c FROM candidates GROUP BY handle HAVING c > 1',
  )
  add('handle is unique across candidates', dupes.length === 0, dupes.map((r) => `${r.handle}x${r.c}`).join(', '))

  const badHandles = q<{ handle: string }>(
    "SELECT handle FROM candidates WHERE handle GLOB '*[^a-z0-9._]*' OR length(handle) > 30 OR trim(handle) = ''",
  )
  add('every handle is bare and lowercase', badHandles.length === 0, badHandles.map((r) => r.handle).join(', '))

  // ── provenance (Law 4) ──────────────────────────────────────────────────
  const noProv = q<{ handle: string }>(
    "SELECT handle FROM candidates WHERE source IS NULL OR trim(source)='' OR first_seen IS NULL OR trim(first_seen)=''",
  )
  add('every candidate carries source + first_seen', noProv.length === 0, `${noProv.length} rows`)
  const obsNoSrc = one<{ c: number }>("SELECT count(*) c FROM observations WHERE source IS NULL OR trim(source)=''")
  add('every observation carries source', obsNoSrc.c === 0, `${obsNoSrc.c} rows`)

  // ── the history chain ───────────────────────────────────────────────────
  const cands = q<{ id: number; handle: string; status: Status }>('SELECT id, handle, status FROM candidates')
  const chainBreaks: string[] = []
  const noGenesis: string[] = []
  const bornMidFunnel: string[] = []
  const outOfOrder: string[] = []

  for (const c of cands) {
    const hist = q<{ from_status: Status | null; to_status: Status; at: string }>(
      'SELECT from_status, to_status, at FROM status_history WHERE candidate_id=? ORDER BY id', c.id,
    )
    if (!hist.length) { chainBreaks.push(`${c.handle}: no history at all`); continue }
    if (hist[0].from_status !== null) noGenesis.push(c.handle)
    if (hist[0].to_status !== 'sourced') bornMidFunnel.push(`${c.handle}: born ${hist[0].to_status}`)
    for (let i = 1; i < hist.length; i++) {
      if (hist[i].from_status !== hist[i - 1].to_status) {
        chainBreaks.push(`${c.handle}: ${hist[i - 1].to_status} then from=${hist[i].from_status}`)
      }
      // Chronology. A replay that inserts hops out of order produces a chain
      // that reads forwards but happened backwards, which silently corrupts
      // every funnel-timing number Part 8.4 computes.
      if (hist[i].at < hist[i - 1].at) {
        outOfOrder.push(`${c.handle}: ${hist[i - 1].at} then ${hist[i].at}`)
      }
    }
    if (hist[hist.length - 1].to_status !== c.status) {
      chainBreaks.push(`${c.handle}: history ends at ${hist[hist.length - 1].to_status}, row says ${c.status}`)
    }
  }
  add('current status is reconstructible from history for every candidate', chainBreaks.length === 0, chainBreaks.slice(0, 3).join(' | '))
  add('every candidate has a genesis history row', noGenesis.length === 0, noGenesis.slice(0, 5).join(', '))
  add('every candidate was born sourced, not minted mid-funnel', bornMidFunnel.length === 0, bornMidFunnel.slice(0, 3).join(' | '))
  add('history timestamps never go backwards within a candidate', outOfOrder.length === 0, outOfOrder.slice(0, 3).join(' | '))

  const orphan = one<{ c: number }>(
    'SELECT count(*) c FROM status_history sh LEFT JOIN candidates c ON c.id=sh.candidate_id WHERE c.id IS NULL',
  )
  add('no orphaned history rows', orphan.c === 0, `${orphan.c} orphans`)

  // ── LAW 10: a candidate becomes DM-able only through human ratification ──
  // The restore importer is the one code path in the system able to produce a
  // `qualified` candidate without going through applyRatifyDecision, so this
  // is the invariant that catches a restore inventing judgment nobody made.
  // Scoped to the sourced -> qualified hop, which IS the ratify-queue door;
  // `banked -> qualified` is the drawer's manual move (ratified A1) and
  // carries no queue decision by design.
  const unratified = q<{ handle: string; at: string }>(
    `SELECT c.handle, h.at
       FROM status_history h JOIN candidates c ON c.id = h.candidate_id
      WHERE h.from_status = 'sourced' AND h.to_status = 'qualified'
        AND NOT EXISTS (
          SELECT 1 FROM ratifications r
           WHERE r.candidate_id = c.id AND r.decision = 'approve' AND r.at <= h.at
        )`,
  )
  add('every sourced->qualified hop is backed by an approve ratification (Law 10)',
    unratified.length === 0, unratified.slice(0, 3).map((r) => `${r.handle}@${r.at}`).join(', '))

  // ── LOI + follow-up policy (Part 8.2) ───────────────────────────────────
  const unsigned = q<{ handle: string }>(
    "SELECT handle FROM candidates WHERE status='signed' AND (loi_tier IS NULL OR trim(loi_tier)='')",
  )
  add('no signed candidate lacks an loi_tier', unsigned.length === 0, unsigned.map((r) => r.handle).join(', '))
  const badTier = q<{ handle: string }>(
    `SELECT handle FROM candidates WHERE loi_tier IS NOT NULL AND loi_tier NOT IN (${LOI_TIERS.map((t) => `'${t}'`).join(',')})`,
  )
  add('every loi_tier is a Part III enum value', badTier.length === 0, badTier.map((r) => r.handle).join(', '))

  // LAW 2, made real. followup_count is derived, not decorative: the first
  // outbound message is the DM, the second is the single permitted follow-up,
  // and there is never a third touch. Asserting the counter AGREES with the
  // log is what stops it drifting back into the ornament it used to be.
  const followupDrift = q<{ handle: string; followup_count: number; outs: number }>(
    `SELECT c.handle, c.followup_count,
            (SELECT count(*) FROM outreach_log o WHERE o.candidate_id=c.id AND o.direction='out') outs
       FROM candidates c
      WHERE c.followup_count <> max(0, (SELECT count(*) FROM outreach_log o WHERE o.candidate_id=c.id AND o.direction='out') - 1)`,
  )
  add('followup_count equals outbound-minus-one for every candidate (Law 2)',
    followupDrift.length === 0,
    followupDrift.slice(0, 3).map((r) => `${r.handle} count=${r.followup_count} outs=${r.outs}`).join(', '))

  const overTouched = q<{ handle: string; outs: number }>(
    `SELECT c.handle, count(o.id) outs FROM candidates c JOIN outreach_log o ON o.candidate_id=c.id
      WHERE o.direction='out' GROUP BY c.id HAVING outs > ${FOLLOWUP.maxPerCandidate + 1}`,
  )
  add(`no candidate received more than ${FOLLOWUP.maxPerCandidate + 1} outbound messages (never a third touch)`,
    overTouched.length === 0, overTouched.map((r) => `${r.handle}=${r.outs}`).join(', '))

  // ── budget (Law 6) ──────────────────────────────────────────────────────
  for (const cat of SPEND_CATEGORIES) {
    const spent = one<{ s: number }>('SELECT COALESCE(SUM(amount),0) s FROM spend WHERE category=?', cat).s
    add(`spend.${cat} is within its $${CAPS[cat]} cap`, spent <= CAPS[cat], `$${spent.toFixed(4)}`)
  }
  const total = one<{ s: number }>('SELECT COALESCE(SUM(amount),0) s FROM spend').s
  add(`total spend is within the $${CAPS.total} campaign cap`, total <= CAPS.total, `$${total.toFixed(4)}`)

  // ── the Observatory (Part IX write-discipline) ──────────────────────────
  const allNull = one<{ c: number }>(
    `SELECT count(*) c FROM observations
      WHERE follower_count IS NULL AND posts_30d IS NULL
        AND engagement_proxy IS NULL AND (format_mix IS NULL OR format_mix = 'null')`,
  )
  add('no all-null observation exists (Part IX: a metric-free row is noise)', allNull.c === 0, `${allNull.c} rows`)

  // ── the pre-score kill is final (Law 7 leak class) ─────────────────────
  const enrichedKills = q<{ handle: string; pre_score: number }>(
    'SELECT handle, pre_score FROM candidates WHERE pre_score IS NOT NULL AND pre_score < ? AND last_enriched IS NOT NULL',
    PRESCORE_THRESHOLD,
  )
  add('no killed candidate carries an enrichment timestamp',
    enrichedKills.length === 0, enrichedKills.map((r) => `${r.handle}=${r.pre_score}`).join(', '))

  // ── scoring provenance ──────────────────────────────────────────────────
  const unversioned = one<{ c: number }>(
    "SELECT count(*) c FROM candidates WHERE tier IS NOT NULL AND tier <> 'X' AND score_prompt_version IS NULL",
  )
  add('every non-X tier carries the prompt version that produced it', unversioned.c === 0, `${unversioned.c} rows`)

  return out
}

/** Convenience for callers that only need pass/fail. */
export function failedAssertions(results: AssertionResult[]): AssertionResult[] {
  return results.filter((r) => !r.ok)
}
