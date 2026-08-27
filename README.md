# Antenna

Instar's internal prospecting engine: **Harvest → Enrich → Score → Ratify → Track**, plus an
append-only Observatory of the market.

`ANTENNA_BLUEPRINT.md` in this repo is the canon. Code defers to it; where this README and the
blueprint disagree, the blueprint wins.

---

## ⚠️ Never deploy this publicly

Antenna has **no authentication**. It is a single-user tool that runs on `localhost` and nowhere
else. Every row in it is prospect data gathered under Law 5 (public business signals only).

**Do not deploy this to Vercel, a VPS, a tunnel, or any host reachable from the internet without
adding authentication first.** There is no login wall to forget to configure — there is no login
wall at all.

---

## Phase status

| Phase | Scope | State |
|---|---|---|
| **A1** | Spine + Track — schema, `/pipeline`, `/add`, check suite, backup | ✅ built |
| A2 | Score + Ratify + golden set | not started |
| A3 | Harvest adapters | not started |
| A4 | Metrics + the measured run | not started |

Routes for later phases (`/ratify`, `/metrics`, `/settings`) are shown greyed in the nav so the
cockpit's shape is legible; they are not built yet.

## Setup

```bash
npm install
npm run seed        # creates ./antenna.db and adds 5 example candidates
npm run dev         # http://localhost:3000
```

`npm run dev` and `npm run start` migrate first automatically, so a fresh clone just works;
`npm run migrate` on its own is only needed after you edit the schema. Seeding is optional — skip
it and start from an empty pipeline.

`.env.local` (gitignored, never committed, never logged) — not needed until A2:

```
ANTHROPIC_API_KEY=...   # A2: pre-score + full score
SERPER_API_KEY=...      # A3: seller-exhaust SERP queries
APIFY_TOKEN=...         # A3: no-login IG data actors
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on :3000 |
| `npm run build` | Production build |
| `npm run migrate` | Apply migrations + (re)install enforcement triggers. Idempotent; runs automatically before `dev`/`start`. |
| `npm run seed` | Add the 5 fixtures. `-- --reset` drops candidates first. |
| `npm run check` | **Part 2.6 check suite.** Runs green or nothing ships. |
| `npm run check:golden` | Scoring regression (Part 6.6). PENDING until A2. |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run backup` | Timestamped copy to `~/Backups/antenna/` |
| `npm run db:generate` | Generate a migration after editing `db/schema.ts` |

**Never hand-edit the database.** Change `db/schema.ts`, run `npm run db:generate`, then
`npm run migrate`.

**Back up at the end of every operating session** — `npm run backup` belongs in the session-close
habit (Part XIV). It uses SQLite's online backup API, so it is safe to run while the dev server is
up; a plain `cp` of a WAL-mode database can capture a torn file.

## How the guarantees are enforced

The blueprint's hard rules are implemented as **SQLite triggers**, not as app-layer checks, so they
bind every writer — the UI, a tsx script, a future harvest adapter, or a raw `sqlite3` shell:

- `handle` is unique, lowercased and bare — it is the dedupe key (Part III)
- `signed` requires an `loi_tier` (Part 8.2)
- every status change writes a `status_history` row, **no exceptions**
- only Part 8.2 transitions are possible; terminal states have no way out
- **observations are append-only** — `UPDATE` and `DELETE` both abort (Law 9)
- enum columns reject anything outside the Part III string sets
- `followup_count` can never exceed one (Part 8.2: never a third touch)

The triggers are *generated* from `db/enums.ts`, `lib/status.ts` and `config/limits.ts`
(see `db/enforcement.ts`), so the database and the TypeScript cannot drift apart.

`npm run check` verifies all of the above against a throwaway database by trying to violate each
rule with raw SQL and asserting that it fails.

## Layout

```
app/            /pipeline, /add, server actions
components/     hand-built kit — no UI library
db/             schema.ts (Part III canon), enforcement.ts (triggers), repo.ts (the write path)
lib/            status.ts (the Part 8.2 graph), handle.ts (the dedupe key)
config/         limits.ts (caps, thresholds), metros.ts (metros are config, not code)
scripts/        migrate, seed, check, check-golden, backup
```

## The laws this code is bound by

1. **Antenna preps, never sends.** No automation touches a DM, ever. There is no send path in this
   codebase and there must never be one.
2. Never promise what the world controls.
3. No direct Instagram scraping from anything we own. No session cookies, ever, to any service.
4. Provenance on every row — source, query, fetch date.
5. Public business signals only. Trivial delete-on-request.
6. Budget caps live in code (`config/limits.ts`; enforced from A3).
7. The tool never blocks the campaign.
8. **Separate estate** — this repo never touches ficm.
9. Observations are append-only.
10. A candidate becomes DM-able only through human ratification.
