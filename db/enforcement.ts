/**
 * DB-LEVEL ENFORCEMENT — compiled from the canon, applied as SQLite triggers.
 *
 * Why triggers and not app-layer checks: the blueprint's guarantees ("handle
 * unique + lowercased", "signed requires loi_tier", "every status change writes
 * status_history", "observations are append-only") must hold for ANY writer —
 * the UI, a tsx script, a future harvest adapter, or a raw `sqlite3` shell. An
 * app-layer check only binds the code path that remembers to call it.
 *
 * Everything here is GENERATED from a single source of truth:
 *   - the enum lists in db/enums.ts
 *   - the transition graph in lib/status.ts
 *   - the follow-up policy in config/limits.ts
 * so the database and the TypeScript can never drift apart.
 */
import { FOLLOWUP } from '@/config/limits'
import { TRANSITIONS } from '@/lib/status'
import {
  DECISIONS, DIRECTIONS, LINK_FETCH_STATUSES, LOI_TIERS, METROS, RUN_STATUSES,
  SPEND_CATEGORIES, STATUSES, TIERS,
} from './enums'

/** ISO-8601 UTC with milliseconds — byte-identical in shape to JS toISOString(). */
export const SQL_NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')"

const list = (values: readonly string[]) => values.map((v) => `'${v}'`).join(', ')
const guard = (cond: string, msg: string) =>
  `  SELECT CASE WHEN ${cond} THEN RAISE(ABORT, '${msg.replace(/'/g, "''")}') END;`

/** Row-shape rules that must hold on both INSERT and UPDATE of a candidate. */
function candidateRowGuards(): string[] {
  return [
    guard("NEW.handle IS NULL OR trim(NEW.handle) = ''", 'handle is required'),
    // A character whitelist, not `handle <> lower(handle)`: SQLite's lower() folds
    // ASCII only, so 'Ärnold' would slip past a lower()-based guard and sit in the
    // table un-normalized, defeating the dedupe key. This mirrors HANDLE_RE in
    // lib/handle.ts exactly, and subsumes the bare-handle check.
    guard("NEW.handle GLOB '*[^a-z0-9._]*'", 'handle must be lowercase a-z 0-9 . _ only (Part III: handle is the dedupe key)'),
    guard('length(NEW.handle) > 30', 'handle must be at most 30 characters'),
    guard("NEW.source IS NULL OR trim(NEW.source) = ''", 'every candidate carries source (Part 2.6)'),
    guard("NEW.first_seen IS NULL OR trim(NEW.first_seen) = ''", 'every candidate carries first_seen (Part 2.6)'),
    guard(`NEW.status NOT IN (${list(STATUSES)})`, 'invalid status (Part III enum)'),
    guard(`NEW.tier IS NOT NULL AND NEW.tier NOT IN (${list(TIERS)})`, 'invalid tier (Part III enum)'),
    guard(`NEW.loi_tier IS NOT NULL AND NEW.loi_tier NOT IN (${list(LOI_TIERS)})`, 'invalid loi_tier (Part III enum)'),
    guard(`NEW.metro IS NOT NULL AND NEW.metro NOT IN (${list(METROS)})`, 'invalid metro (Part III enum)'),
    guard(
      `NEW.link_fetch_status IS NOT NULL AND NEW.link_fetch_status NOT IN (${list(LINK_FETCH_STATUSES)})`,
      'invalid link_fetch_status (Part III enum)',
    ),
    guard(
      'NEW.metro_confidence IS NOT NULL AND (NEW.metro_confidence < 0 OR NEW.metro_confidence > 1)',
      'metro_confidence must be between 0 and 1',
    ),
    guard('NEW.pre_score IS NOT NULL AND (NEW.pre_score < 0 OR NEW.pre_score > 100)', 'pre_score must be 0-100'),
    guard('NEW.score IS NOT NULL AND (NEW.score < 0 OR NEW.score > 100)', 'score must be 0-100'),
    guard(
      `NEW.followup_count < 0 OR NEW.followup_count > ${FOLLOWUP.maxPerCandidate}`,
      `follow-up policy (Part 8.2): at most ${FOLLOWUP.maxPerCandidate} follow-up per candidate, never a third touch`,
    ),
    guard(
      "NEW.status = 'signed' AND (NEW.loi_tier IS NULL OR trim(NEW.loi_tier) = '')",
      'signed requires loi_tier (Part 8.2)',
    ),
    guard('NEW.score_failed NOT IN (0, 1)', 'score_failed is a 0/1 flag (Part 6.2)'),
  ]
}

/** The Part 8.2 graph, compiled to SQL straight from lib/status.ts. */
function transitionGuard(): string {
  const legal = STATUSES
    .filter((s) => TRANSITIONS[s].length > 0)
    .map((s) => `(OLD.status = '${s}' AND NEW.status IN (${list(TRANSITIONS[s])}))`)
    .join('\n         OR ')
  return guard(`NEW.status <> OLD.status AND NOT (\n         ${legal}\n       )`,
    'illegal status transition (Part 8.2: allowed transitions only)')
}

type Trigger = { name: string; sql: string }

function triggers(): Trigger[] {
  const rows = candidateRowGuards().join('\n')
  return [
    {
      // A candidate is BORN sourced (Part IV: the pipeline "inserts as sourced";
      // Part 8.2 has exactly one entry point). Without this, `INSERT OR REPLACE`
      // teleports an existing candidate to any status: REPLACE deletes the old
      // row without firing delete triggers, the FK cascade takes its whole
      // status_history chain with it, and the genesis trigger then fabricates a
      // single `NULL -> signed` row in its place. Insert-only, never on UPDATE.
      name: 'candidates_guard_insert',
      sql: `CREATE TRIGGER candidates_guard_insert BEFORE INSERT ON candidates\nBEGIN\n${rows}\n${guard(
        "NEW.status <> 'sourced'",
        'a candidate is born sourced (Part IV / Part 8.2): move it with a transition, never mint it mid-funnel',
      )}\nEND;`,
    },
    {
      name: 'candidates_guard_update',
      sql: `CREATE TRIGGER candidates_guard_update BEFORE UPDATE ON candidates\nBEGIN\n${transitionGuard()}\n${rows}\nEND;`,
    },
    {
      // Genesis row: the history table is then a COMPLETE log — current status
      // is always reconstructible from it (npm run check asserts exactly that).
      name: 'candidates_genesis_history',
      sql: `CREATE TRIGGER candidates_genesis_history AFTER INSERT ON candidates\nBEGIN\n  INSERT INTO status_history (candidate_id, from_status, to_status, at, note)\n  VALUES (NEW.id, NULL, NEW.status, COALESCE(NULLIF(trim(NEW.first_seen), ''), ${SQL_NOW}), 'created');\nEND;`,
    },
    {
      // "Written on every transition, no exceptions" (Part III) — this is what
      // makes "no exceptions" true even for a raw UPDATE in a sqlite3 shell.
      name: 'candidates_status_history',
      sql: `CREATE TRIGGER candidates_status_history AFTER UPDATE OF status ON candidates\nWHEN OLD.status IS NOT NEW.status\nBEGIN\n  INSERT INTO status_history (candidate_id, from_status, to_status, at, note)\n  VALUES (NEW.id, OLD.status, NEW.status, ${SQL_NOW}, NULL);\nEND;`,
    },
    {
      // Only fires when the writer did not set updated_at itself. Recursive
      // triggers are OFF (db/client.ts), so this cannot loop.
      name: 'candidates_touch_updated_at',
      sql: `CREATE TRIGGER candidates_touch_updated_at AFTER UPDATE ON candidates\nWHEN NEW.updated_at = OLD.updated_at\nBEGIN\n  UPDATE candidates SET updated_at = ${SQL_NOW} WHERE id = NEW.id;\nEND;`,
    },
    {
      name: 'status_history_guard_insert',
      sql: `CREATE TRIGGER status_history_guard_insert BEFORE INSERT ON status_history\nBEGIN\n${[
        guard(`NEW.to_status NOT IN (${list(STATUSES)})`, 'invalid to_status (Part III enum)'),
        guard(`NEW.from_status IS NOT NULL AND NEW.from_status NOT IN (${list(STATUSES)})`, 'invalid from_status (Part III enum)'),
        guard("NEW.at IS NULL OR trim(NEW.at) = ''", 'status_history.at is required'),
      ].join('\n')}\nEND;`,
    },
    {
      name: 'ratifications_guard_insert',
      sql: `CREATE TRIGGER ratifications_guard_insert BEFORE INSERT ON ratifications\nBEGIN\n${[
        guard(`NEW.decision NOT IN (${list(DECISIONS)})`, 'invalid ratify decision (Part III enum)'),
        guard("NEW.at IS NULL OR trim(NEW.at) = ''", 'ratifications.at is required'),
      ].join('\n')}\nEND;`,
    },
    {
      name: 'outreach_log_guard_insert',
      sql: `CREATE TRIGGER outreach_log_guard_insert BEFORE INSERT ON outreach_log\nBEGIN\n${[
        guard(`NEW.direction NOT IN (${list(DIRECTIONS)})`, 'outreach_log.direction must be out|in (Part III)'),
        guard("NEW.at IS NULL OR trim(NEW.at) = ''", 'outreach_log.at is required'),
      ].join('\n')}\nEND;`,
    },
    {
      name: 'harvest_runs_guard_insert',
      sql: `CREATE TRIGGER harvest_runs_guard_insert BEFORE INSERT ON harvest_runs\nBEGIN\n${[
        guard(`NEW.status NOT IN (${list(RUN_STATUSES)})`, 'invalid harvest_runs.status'),
        guard("NEW.adapter IS NULL OR trim(NEW.adapter) = ''", 'harvest_runs.adapter is required (Law 4: provenance)'),
      ].join('\n')}\nEND;`,
    },
    {
      name: 'harvest_runs_guard_update',
      sql: `CREATE TRIGGER harvest_runs_guard_update BEFORE UPDATE ON harvest_runs\nBEGIN\n${guard(`NEW.status NOT IN (${list(RUN_STATUSES)})`, 'invalid harvest_runs.status')}\nEND;`,
    },
    {
      name: 'spend_guard_insert',
      sql: `CREATE TRIGGER spend_guard_insert BEFORE INSERT ON spend\nBEGIN\n${[
        guard(`NEW.category NOT IN (${list(SPEND_CATEGORIES)})`, 'invalid spend.category (Part III enum)'),
        guard('NEW.amount IS NULL OR NEW.amount < 0', 'spend.amount must be >= 0'),
      ].join('\n')}\nEND;`,
    },
    {
      name: 'observations_guard_insert',
      sql: `CREATE TRIGGER observations_guard_insert BEFORE INSERT ON observations\nBEGIN\n${[
        guard("NEW.handle IS NULL OR trim(NEW.handle) = ''", 'observations.handle is required'),
        guard("NEW.handle GLOB '*[^a-z0-9._]*'", 'observations.handle must be lowercase a-z 0-9 . _ only'),
        guard("NEW.source IS NULL OR trim(NEW.source) = ''", 'every observation carries source (Law 4)'),
      ].join('\n')}\nEND;`,
    },
    // LAW 9 — Observations are append-only. Snapshots accumulate; nothing
    // overwrites history. There is no UPDATE path, by construction.
    {
      name: 'observations_no_update',
      sql: `CREATE TRIGGER observations_no_update BEFORE UPDATE ON observations\nBEGIN\n  SELECT RAISE(ABORT, 'observations are append-only (Law 9): no UPDATE path exists');\nEND;`,
    },
    {
      name: 'observations_no_delete',
      sql: `CREATE TRIGGER observations_no_delete BEFORE DELETE ON observations\nBEGIN\n  SELECT RAISE(ABORT, 'observations are append-only (Law 9): no DELETE path exists');\nEND;`,
    },
  ]
}

/** Names every trigger this file installs — npm run check asserts each is present. */
export const ENFORCEMENT_TRIGGERS: readonly string[] = triggers().map((t) => t.name)

/** Idempotent: drop-then-create, so re-running picks up edits to the canon. */
export function enforcementSql(): string {
  return triggers()
    .map((t) => `DROP TRIGGER IF EXISTS ${t.name};\n${t.sql}`)
    .join('\n\n')
}
