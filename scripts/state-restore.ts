/**
 * `npm run state:restore` — rebuild a database from a state snapshot.
 *
 * The four ratified constraints, each load-bearing:
 *
 *   1. HISTORY IS REPLAYED, NEVER WRITTEN. Every hop goes through
 *      transitionStatus() with its original timestamp, so the Part 8.2 graph
 *      and all 14 triggers validate the restored funnel exactly as they
 *      validated the original. A direct `UPDATE candidates SET status` would
 *      import a shape the live system could never have produced.
 *
 *   2. OBSERVATIONS ARE GUARDED AT THE WRITE. Law 9 makes them undeletable, so
 *      a double restore is not a mistake you can clean up afterwards — it is
 *      permanent. Every snapshot row is matched against what is already there
 *      before it is inserted.
 *
 *   3. THE ACCEPTANCE CHECK RUNS INSIDE THE TRANSACTION. runDbAssertions() is
 *      evaluated before COMMIT; a single red assertion rolls the whole restore
 *      back. Checking after commit would be a report, not a gate — and on the
 *      append-only table, an unretractable one.
 *
 *   4. RESTORE MAY NEVER MINT JUDGMENT. Law 10 says a candidate becomes
 *      DM-able only through human ratification. This importer is the only code
 *      path in the system that could manufacture a `qualified` row with no
 *      decision behind it, so the Law 10 assertion is part of the gate above.
 *
 * Keyed on HANDLE throughout. Candidate ids are autoincrement and re-minted in
 * every fresh database, so an id-keyed restore lands on the wrong people.
 *
 *   npm run state:restore                        # from state/snapshot.json
 *   npm run state:restore -- --snapshot=path.json
 *   npm run state:restore -- --fresh             # wipe and re-migrate first
 *   npm run state:restore -- --dry-run           # do everything, then roll back
 */
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { DB_PATH, getSqlite } from '@/db/connection'
import { recordObservation } from '@/db/observations'
import { addCandidates, logOutreach, recordRatification, transitionStatus } from '@/db/repo'
import type { Status } from '@/db/enums'
import { PipelineHalt } from '@/lib/env'
import { failedAssertions, runDbAssertions } from '@/lib/assertions'
import { runMigrations } from './migrate'

type Row = Record<string, unknown>
export type Snapshot = {
  schema: number
  written_at: string
  candidates: Row[]
  ratifications: Row[]
  status_history: Row[]
  outreach_log: Row[]
  observations: Row[]
  spend: Row[]
  harvest_runs: Row[]
}

const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
const flag = (name: string): boolean => process.argv.includes(`--${name}`)

/** Columns the importer sets directly. `status` is NOT among them — see (1). */
const SCALAR_COLUMNS = [
  'name', 'follower_count', 'bio', 'link_url', 'link_domain', 'link_contents',
  'link_fetch_status', 'metro', 'metro_confidence', 'source_detail', 'last_enriched',
  'pre_score', 'score', 'tier', 'score_prompt_version', 'evidence', 'hook_draft',
  'stack_signals', 'extracted', 'score_failed', 'loi_tier', 'notes', 'next_action_date',
] as const

export type RestoreTally = {
  candidates: number
  historyHops: number
  ratifications: number
  observations: number
  observationsSkipped: number
  outreach: number
  spend: number
  harvestRuns: number
}

export function restoreFromSnapshot(snap: Snapshot, opts: { dryRun?: boolean } = {}): RestoreTally {
  const sqlite = getSqlite()
  const tally: RestoreTally = {
    candidates: 0, historyHops: 0, ratifications: 0, observations: 0,
    observationsSkipped: 0, outreach: 0, spend: 0, harvestRuns: 0,
  }

  // better-sqlite3 transactions are synchronous and nest correctly, so the
  // repo helpers' own transactions compose inside this outer one.
  const run = sqlite.transaction(() => {
    // ── 1. candidates, born sourced ───────────────────────────────────────
    // Through addCandidates() so the genesis trigger fires exactly as it does
    // for a real add. Never INSERT OR REPLACE: on an existing row that would
    // cascade the candidate's whole chain away (guarded since, but the guard
    // is a backstop, not a licence).
    const wanted = snap.candidates.map((c) => String(c.handle))
    const existing = new Set(
      (sqlite.prepare('SELECT handle FROM candidates').all() as { handle: string }[]).map((r) => r.handle),
    )
    const toAdd = wanted.filter((h) => !existing.has(h))
    if (toAdd.length) {
      const outcomes = addCandidates(toAdd, 'restore')
      tally.candidates = outcomes.filter((o) => o.kind === 'added').length
    }

    const idOf = new Map<string, number>(
      (sqlite.prepare('SELECT id, handle FROM candidates').all() as { id: number; handle: string }[])
        .map((r) => [r.handle, r.id]),
    )

    // Restore provenance and scalars. source/first_seen come from the snapshot
    // (addCandidates stamped 'restore' and now()), so the row reads as what it
    // originally was, not as an artefact of the rebuild.
    const setScalars = sqlite.prepare(
      `UPDATE candidates SET source = ?, first_seen = ?, ig_url = COALESCE(?, ig_url), created_at = ?,
         ${SCALAR_COLUMNS.map((c) => `${c} = ?`).join(', ')}, updated_at = ?
       WHERE id = ?`,
    )
    for (const c of snap.candidates) {
      const id = idOf.get(String(c.handle))
      if (!id) continue
      setScalars.run(
        c.source, c.first_seen, c.ig_url, c.created_at,
        ...SCALAR_COLUMNS.map((col) => (c[col] ?? null) as never),
        c.updated_at, id,
      )
    }

    // ── 2. replay the funnel, in the order it happened ────────────────────
    // Genesis rows are skipped: the trigger already wrote one per candidate.
    const hops = snap.status_history
      .filter((h) => h.from_status !== null && h.from_status !== undefined)
      .sort((a, b) => String(a.at).localeCompare(String(b.at)))
    for (const h of hops) {
      const id = idOf.get(String(h.handle))
      if (!id) continue
      const current = (sqlite.prepare('SELECT status FROM candidates WHERE id=?').get(id) as { status: Status }).status
      if (current !== h.from_status) continue // already there, or a divergent chain
      transitionStatus(id, h.to_status as Status, {
        at: String(h.at),
        note: (h.note as string | null) ?? null,
        loiTier: undefined,
      })
      tally.historyHops++
    }

    // Restore the exact status_history timestamps/notes the snapshot carried
    // for genesis rows too, so first_seen and the genesis stamp agree.
    for (const h of snap.status_history) {
      if (h.from_status !== null && h.from_status !== undefined) continue
      const id = idOf.get(String(h.handle))
      if (!id) continue
      sqlite
        .prepare(
          `UPDATE status_history SET at = ?, note = ?
            WHERE candidate_id = ? AND from_status IS NULL`,
        )
        .run(h.at, (h.note as string | null) ?? null, id)
    }

    // ── 3. ratifications — the irreplaceable half ─────────────────────────
    for (const r of snap.ratifications) {
      const id = idOf.get(String(r.handle))
      if (!id) continue
      const dupe = sqlite
        .prepare('SELECT count(*) c FROM ratifications WHERE candidate_id=? AND decision=? AND at=?')
        .get(id, r.decision, r.at) as { c: number }
      if (dupe.c) continue
      recordRatification(id, r.decision as 'approve' | 'reject' | 'bank' | 'flag',
        (r.reason as string | null) ?? null, String(r.at))
      tally.ratifications++
    }

    // ── 4. outreach, through logOutreach so followup_count stays derived ───
    for (const o of snap.outreach_log) {
      const id = idOf.get(String(o.handle))
      if (!id) continue
      const dupe = sqlite
        .prepare('SELECT count(*) c FROM outreach_log WHERE candidate_id=? AND direction=? AND at=?')
        .get(id, o.direction, o.at) as { c: number }
      if (dupe.c) continue
      logOutreach(id, o.direction as 'out' | 'in', (o.text as string | null) ?? null, String(o.at))
      tally.outreach++
    }

    // ── 5. observations — guarded at the write (Law 9, constraint 2) ──────
    const obsExists = sqlite.prepare(
      `SELECT count(*) c FROM observations
        WHERE handle = ? AND observed_at = ? AND source = ?
          AND follower_count IS ? AND posts_30d IS ? AND engagement_proxy IS ?`,
    )
    for (const o of snap.observations) {
      const dupe = obsExists.get(
        o.handle, o.observed_at, o.source, o.follower_count ?? null,
        o.posts_30d ?? null, o.engagement_proxy ?? null,
      ) as { c: number }
      if (dupe.c) { tally.observationsSkipped++; continue }
      recordObservation({
        handle: String(o.handle),
        observedAt: String(o.observed_at),
        followerCount: (o.follower_count as number | null) ?? null,
        posts30d: (o.posts_30d as number | null) ?? null,
        formatMix: o.format_mix ? (JSON.parse(String(o.format_mix)) as Record<string, number>) : null,
        engagementProxy: (o.engagement_proxy as number | null) ?? null,
        source: String(o.source),
      })
      tally.observations++
    }

    // ── 6. the ledgers ────────────────────────────────────────────────────
    const spendDupe = sqlite.prepare(
      'SELECT count(*) c FROM spend WHERE at=? AND category=? AND amount=? AND run_ref IS ?',
    )
    const insSpend = sqlite.prepare(
      'INSERT INTO spend (at, category, amount, run_ref, note) VALUES (?, ?, ?, ?, ?)',
    )
    for (const s of snap.spend) {
      if ((spendDupe.get(s.at, s.category, s.amount, s.run_ref ?? null) as { c: number }).c) continue
      insSpend.run(s.at, s.category, s.amount, s.run_ref ?? null, s.note ?? null)
      tally.spend++
    }

    const runDupe = sqlite.prepare('SELECT count(*) c FROM harvest_runs WHERE adapter=? AND started_at=?')
    const insRun = sqlite.prepare(
      `INSERT INTO harvest_runs (adapter, params, started_at, finished_at, items_found, items_new, est_cost, status, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const r of snap.harvest_runs) {
      if ((runDupe.get(r.adapter, r.started_at) as { c: number }).c) continue
      insRun.run(
        r.adapter, r.params ?? null, r.started_at, r.finished_at ?? null,
        r.items_found ?? null, r.items_new ?? null, r.est_cost ?? null,
        r.status ?? 'ok', r.error ?? null,
      )
      tally.harvestRuns++
    }

    // ── 7. THE GATE (constraints 3 + 4) ───────────────────────────────────
    const failed = failedAssertions(runDbAssertions(sqlite))
    if (failed.length) {
      throw new PipelineHalt(
        `RESTORE ROLLED BACK — ${failed.length} invariant(s) failed inside the transaction:\n\n` +
        failed.map((f) => `  ✗ ${f.label}${f.detail ? `\n      ${f.detail}` : ''}`).join('\n') +
        '\n\nNothing was written. The database is exactly as it was.',
      )
    }
    if (opts.dryRun) {
      throw new PipelineHalt(
        'DRY RUN — the restore completed and every invariant passed, then rolled back on purpose.\n' +
        `Would have written: ${JSON.stringify(tally)}`,
      )
    }
  })

  run()
  return tally
}

function main(): void {
  const path = arg('snapshot') ?? 'state/snapshot.json'
  if (!existsSync(path)) {
    throw new PipelineHalt(
      `No snapshot at ${path}. It is gitignored by design (Law 5), so a fresh container has none:\n` +
      'restore it from wherever you saved the file `npm run state:export` handed you.',
    )
  }

  if (flag('fresh')) {
    // Must happen before any handle is opened, which is why it lives here and
    // not inside restoreFromSnapshot.
    for (const suffix of ['', '-wal', '-shm']) rmSync(DB_PATH + suffix, { force: true })
    runMigrations(DB_PATH)
    console.log(`wiped and re-migrated ${DB_PATH}`)
  }

  const snap = JSON.parse(readFileSync(path, 'utf8')) as Snapshot
  console.log(`\nRESTORE from ${path} (written ${snap.written_at})\n`)

  const tally = restoreFromSnapshot(snap, { dryRun: flag('dry-run') })

  console.log('  restored:')
  for (const [k, v] of Object.entries(tally)) console.log(`    ${String(v).padStart(5)}  ${k}`)
  console.log('\n  every invariant passed inside the transaction before it committed.')
  console.log('  run `npm run state:export` to move the census to the restored state.\n')
}

if (require.main === module) {
  try {
    main()
  } catch (e) {
    if (e instanceof PipelineHalt) {
      console.error(`\n■ ${e.message}\n`)
      process.exit(2)
    }
    throw e
  }
}
