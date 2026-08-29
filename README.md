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
| **A2** | Score + Ratify — pipeline, prompts, few-shot loop, `/ratify` | ✅ build half done · calibration + golden set pending |
| **A3** | Harvest — adapters, `/settings`, `/metrics` (pulled forward) | ✅ build half done · real providers await keys + ratified libraries |
| A4 | Export + the measured run | not started |

All five canon routes are live. Real harvest providers are stubs that halt naming their exact
ask; fixture providers run the whole flow offline. The query/hashtag/seed configs are DRAFT —
`npm run check` asserts the markers until the operator ratifies them.

## Setup

```bash
npm install
npm run seed        # creates ./antenna.db and adds 5 example candidates
npm run dev         # http://localhost:3000
```

`npm run dev` and `npm run start` migrate first automatically, so a fresh clone just works;
`npm run migrate` on its own is only needed after you edit the schema. Seeding is optional — skip
it and start from an empty pipeline.

`.env.local` (gitignored, never committed, never logged) — the Anthropic key is needed the
moment you score; without it the pipeline enriches, then halts with instructions:

```
ANTENNA_ANTHROPIC_KEY=...  # A2: pre-score (claude-haiku-4-5) + full score (claude-sonnet-4-6)
SERPER_API_KEY=...         # A3: seller-exhaust SERP queries
APIFY_TOKEN=...            # A3: no-login IG data actors
```

`ANTENNA_ANTHROPIC_KEY` is the canonical name: the deploy platform filters the reserved name
`ANTHROPIC_API_KEY` out of the environment it hands the process. `ANTHROPIC_API_KEY` is still
accepted as a fallback, so an existing local `.env.local` keeps working. First non-empty wins,
canonical first — `npm run keys` prints which name actually loaded.

Until the A3 actor lands, enrichment reads profile packets from `pipeline/fixtures/profiles.json`
(fake, committed) and `./profiles/*.json` (real, gitignored — drop hand-assembled packets there
for the calibration run).

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
| `npm run pipeline` | Enrich → pre-score → score everything `sourced`. `-- --provider=actor` halts until A3 wiring. |
| `npm run harvest` | Run an adapter: `-- --adapter=serper\|hashtags\|commenters --metro=nyc\|sofla [--provider=real]` |
| `npm run test:fetchlink` | fetchLink unit test vs a loopback server (Law 3 refusal, rate limit, timeout, JS-shell rule) |
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
- only Part 8.2 transitions are possible; the three terminal states (`signed`, `declined`,
  `rejected`) have no way out
- the two re-entry edges are `no_response → replied` (a ghost who answers late) and
  `banked → qualified` (wave-three activation) — manual, from the drawer, never automated
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
