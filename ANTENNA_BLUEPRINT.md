# ANTENNA — THE OUTREACH ENGINE BLUEPRINT
*The complete, build-ready design for Instar's internal prospecting engine: find, score, and work LOI candidates — and accumulate a proprietary observatory of the market while doing it. **This document supersedes the same-session spec draft.** It is written so a brand-new chat, with no other context beyond the Instar project documents, knows exactly what to build, in what order, with what prompts, and how to run it afterward.*

**Status**: Blueprint, ratified-pending-§15. Build begins **after the Friday Christopher meeting** — nothing here touches the Friday critical path. Serves the second validation gate (Ashok's bar: mockup ✅ + 10 LOIs).

**Read order for a new chat**: this document top to bottom → doc 08 Part III (the LOI campaign) → doc 11 (methodology; the phase-prompt rules apply here unchanged).

---

# PART 0 — ORIENTATION & STATUS BOARD

| Fact | State |
|---|---|
| What | Single-user internal tool: Harvest → Enrich → Score → Ratify → Track, plus an append-only Observatory |
| Where | **Own repo, never ficm.** Recommended: private repo `antenna` on Conner's personal GitHub, local-first on the MacBook |
| Who builds | Claude Code (builder), directed by phase prompts from the command center — the two-surface model, unchanged |
| Who operates | Conner only. No auth, localhost only, never deployed publicly |
| Campaign | NYC + South Florida first · goal 20–25 signed LOIs, ≥8–10 at tier T2/T3 · **Ashok's gate stays 10** |
| Budget | Hard cap **$250** total external spend, enforced in code |
| Timeline | A1–A2 evenings post-Friday · A3 weekend · A4 (hour of truth) before wave one · wave one launches after Christopher confirms |
| Build state | **A1 shipped** · **A2 build half shipped + ratified**; **calibration batch SCORED, RATIFIED and RE-SCORED under the national rubric** (32 profiles: A:4 B:5 C:2 X:21 · `check:golden` **GREEN 96.2%**) · **the founding cohort is NATIONAL** — `score_v2`/`prescore_v2` shipped + ratified (Parts 6.7/6.8) · **A3 build half shipped + ratified** · **durability + erasure shipped + ratified** (Part X.2) · **remote state store shipped + ratified** (Part X.3 — primary durability layer, purge proven on the wire) · A4: /metrics pulled forward, export + measured run remain |

## Phase log

**A2-national — the founding cohort goes NATIONAL; score_v2 / prescore_v2 · 2026-08-30 · shipped and RATIFIED.** Decision **(b)**: the founding cohort is national, and metro becomes a convenience rather than a requirement.

*The evidence that forced it*, all from the calibration batch rather than from argument: **30 of 32 profiles scored `metro` 0/15**, including **every single approval**; with metro at floor and `size_band` at the quarter-point floor, the reachable ceiling was **70 against an A-cut of 75**, so **tier A was structurally unreachable** for a nationally-sourced batch before the model read a caption. Fifteen points nobody can earn are not a dimension, they are a ceiling.

*Where the operator's taste actually concentrated* — mean dimension scores across the ten gate-passing profiles, approvals vs banks:

| dimension | approve (n=4) | bank (n=5) | Δ |
|---|---|---|---|
| `dm_run` | 22.3 / 25 | 14.8 / 25 | **+7.5** |
| `online_purity` | 13.0 / 15 | 10.8 / 15 | **+2.2** |
| `engagement_proxy` | 3.0 / 5 | 2.4 / 5 | +0.6 |
| `activity` | 8.5 / 10 | 8.0 / 10 | +0.5 |
| `size_band` | 5.0 / 20 | 8.0 / 20 | **−3.0** |
| `metro` | 0 / 15 | 0 / 15 | **0** |

Two readings, both load-bearing. `metro` carried **literally zero** discriminating signal. And `size_band` was **inverted** — banks outscored approvals, because @santinoanzevino at 3,619 took full marks under the old 1K–10K band while every approval took the floor. So the freed 10 points went **7 to `dm_run`, 3 to `online_purity`**, matching the observed Δ ratio; splitting them evenly would have over-weighted purity against the evidence.

*The size curve, rebuilt from the verdicts* (`config/limits.ts`, **computed in code** — a seven-band lookup on a known integer has no judgement in it, and the A2 run measured what happens when arithmetic is left to a model): 3K–80K full 20 · 500–3K and 80K–150K partial · tapering to 1 above 600K · **unknown → 10, the neutral midpoint, never 0**. Two breakpoints carry specific verdicts: **80–150K at 8** because @koda.kammer (115,461) was banked "right coach, wrong wave (size)" and would reach A at 12; **>600K at 1** because @hunterstein_wk (718,043) is otherwise a maxed profile and only a punitive top band keeps a "too big to cold DM" verdict intact.

*Tier cuts unchanged* (A ≥ 75 · B 55–74 · C 40–54). The ceiling was broken, not the cuts: a national profile can now reach 95.

*Result, re-scoring all 32 under `score_v3`*: **A:4 · B:5 · C:2 · X:21**, and `check:golden` **GREEN at 96.2%** (25/26). All four metro-blind approvals moved **B 61–63 → A 84–86**. The banks landed where the verdicts said: @hunterstein_wk B 61, @koda.kammer B 71, @santinoanzevino B 69. The eligibility gate (6.2a) caught @tommy_lifts10 deterministically at **X 0 with no paid call**.

*The one disagreement is honest.* @cruzbrahh was labelled A and scored **B 69**. The refetch that was supposed to give the gate real evidence gave it something else too: the first actor run had returned **no follower count and no captions**, and the second returned **345,635 followers** and twelve. So the profile the operator approved as an unknown is a 345K account, which the ratified curve scores 3/20. The `unknown → 10` rule stands as policy; it simply no longer applies to the profile it was written for. Persisted through `applyPacket` so the database, the observation panel and the frozen input all agree — a refetch that updated only the packet cache would have left `score.ts` judging on the facts the first run missed.

**A2-calibration — the scoring run, the prescore-bypass deviation, and the remote store · 2026-08-30 · shipped and RATIFIED.** Commits: `17d6a5c` calibration run · `+ carve-out, re-ratification, remote store, canon`. Branch consolidation: every branch merged to `main` and deleted; standing policy is now that **every commit reaches `main` before session end**.

*The deviation, ratified before the run*: for this batch only, the pre-score **kill gate was bypassed** — the pre-score still ran and its verdict and `kill_reasons` were recorded as evidence, but all 32 were full-scored regardless. A killed candidate yields nothing for a ratify pass to disagree with, and the size band cannot be re-cut from a population the gate already truncated. The bypass lives in `scripts/calibrate.ts` alone: `PRESCORE_THRESHOLD` was never touched and normal gating stayed armed for harvest. `score_context=calibration` was written to `notes` — a Part III column — rather than as a new column, because Part III's column list is canon and a third allowed extra is a ratification, not a side effect of a scoring run.

*Result*: **32 scored — A:0 · B:7 · C:1 · X:24**, zero score failures, $0.5934 of LLM spend. **26 of 32 would have been killed by the gate.**

***The gate was wrong in both directions.*** Five of the 26 condemned scored C or better — including **@santinoanzevino at 3,619 followers, squarely inside the 1K–10K ideal band, killed at pre-score 15 and scored B 62 with `size_band` 20/20**. Conversely three of the six the gate would have *passed* scored X. The dominant kill reason was **size**: `prescore_v1.md` hardcodes "roughly 500–20,000 followers" and an auto-kill above 60,000, and that single rule drove nearly every kill. `prescore_v2` is deliberately **not** being written yet — the ratify verdicts define the new band first, then the prompt follows the band rather than the band following the prompt.

*A second finding, and the reason score artifacts changed shape*: the model disagreed with its own rubric arithmetic on **24 of 32**, almost always by exactly the `+10` base it had not applied, and **6 of the 7 B tiers existed only because `computeScoreAndTier` overrode it** — on two of them the model itself said X. The override is the design working as intended. But the model's own claim was recoverable only from console scrollback, so `ScoreOutcome` now carries `claimed` alongside the computed values and the run artifact records both. A score record that keeps only the winner cannot be diffed.

*The Law 7 carve-out (ratified)*: the batch was enriched **before** it was pre-scored, so 26 rows carry both a sub-threshold `pre_score` and an enrichment timestamp — which the old assertion read as a leak. The leak it actually guards is *money*: paying to enrich something the cheap filter already killed. So the predicate is now **temporal, not positional** — enrichment *before* the pre-score is allowed, enrichment *after* stays red, and **unprovable ordering fails closed**, because an invariant that assumes innocence when it cannot tell is not an invariant. Ordering is read from the **ledger** (`spend.run_ref = 'prescore:<handle>'`), not from `updated_at`, because a spend row is append-only and survives export/restore while `updated_at` is rewritten by every later write. `check.ts` §14 proves the carve-out **both ways**.

*The ratify pass, and the finding that came out of it*: **approve 4 · reject 21 · bank 6 · flag 1**, every verdict entered through `applyRatifyDecision` so the Part 8.2 graph, the Law 10 gate and the write-through fired as they would from the keyboard. Reject reasons went to the canon picker (Part VII line 374) with the operator's verbatim wording preserved on `notes`, since the picker's seven words are narrower than the verdicts and the verdicts are the Part 6.5 training signal.

***`check:golden` is RED at 84%, and the red is the finding.*** All four disagreements are the four approvals, each scored **B**, none scored A. The cause is arithmetic, not taste: **30 of 32 profiles scored `metro` 0/15**, and every approved profile also scored `size_band` 5/20. With those two dimensions at floor the maximum reachable score is **25+5+0+15+10+5 +10 = 70**, and tier A needs **75** — so **A was structurally unreachable for this entire batch** before the model read a single caption. The four approvals are maxed everywhere they *could* earn: `dm_run` 22–23/25, `online_purity` 13/15, `activity` 8–9/10. The scorer and the operator have not disagreed about these coaches; the rubric allocates **35 of 90 points to metro and size**, and a batch sourced by hashtag and SERP rather than by metro cannot earn them. That is the same defect the pre-score band showed, one layer deeper, and it is the input to the band decision rather than something to tune away.

*Ratified at the close*: the five picker mappings where a verdict had no enum equivalent (#13 `other`, #15 `other`, #17 `other`, #19 `not-a-coach`, #31 `dead`) · the operator's words attached to all four approvals, re-entered through **undo → re-apply** rather than an `UPDATE`, because `ratifications` is Part 6.5 training data and Part 2.2 forbids hand-editing — the round trip stays visible in `status_history`, which is the honest record · **the new eligibility gate (6.2a)** · `check:golden` left RED pending the score_v2 decision.

*A latent defect the re-apply surfaced, fixed*: the Law 10 assertion required every `sourced → qualified` hop to be backed by an approve ratification — but **undo deletes the ratification while canon deliberately keeps the hop** ("the history keeps the truth that the round-trip happened"). So an undone hop is permanently unbacked by design, and **a single `u` keystroke in `/ratify` would have turned `npm run check` red and kept it red** — a suite the operator would soon learn to ignore. Nobody had pressed `u` on real data until the approval reasons needed re-entering. The assertion now excuses a hop that a LATER `qualified → sourced` edge shows was withdrawn, and nothing else: a candidate sitting at `qualified` with no approve behind it still fails, which is the guarantee Law 10 actually makes. Proven both ways in §6b.

*The actor, re-ratified for git*: `config/actors.ts` had only ever read DRAFT in git history, while the ledger showed a smoke test followed by a 32-handle scale run. The ratification had lived in an uncommitted working tree and died with the container. It is now recorded in the file with its full evidence — smoke `H9wnMKKDF50CPcKWn` $0.0052 3/3 · scale `QI1TA8oJBccV0BHp3` 32 handles $0.0806 · `calibrate:refetch` 32/32 $0.0312 — and that same lesson is why the remote store (Part X.3) exists.

**A2-calibration — durability, erasure, and four verified defects · 2026-08-28 · shipped and RATIFIED.** Commits: `d41ee9e` calibration wiring · `cae716e` durability tripwire + two Law holes · `+ durability: restore, forget, write-through + canon update`.

*What it started as*: "calibrate — the keys are in `.env.local`". They were not: this is an ephemeral container and no `.env.local` exists on it, `api.apify.com` is blocked by the environment's egress policy (403 `host_not_allowed`), and `api.anthropic.com` is reachable. So the calibration batch is blocked on account/environment access, not on code, and the operator's question — *"what happens to my ratifications when the container dies?"* — turned out to be the load-bearing one.

*Four defects, each verified against a copy of the live database rather than reasoned about*: **(1)** a fresh empty database passed the ENTIRE check suite **CHECK GREEN** — amnesia was completely silent, and Law 2's "no lost data" was an assertion, not a fact. **(2)** `INSERT OR REPLACE INTO candidates` with `status='sourced'` passed every guard and cascade-deleted the row's ratifications, history and outreach (REPLACE fires no delete triggers while `recursive_triggers` is OFF); the existing tripwire only tested the `'signed'` variant, which aborts on the birth-status guard for an unrelated reason, so the hole was never covered — and the fixed guard needed **two** branches (id and handle collision), each of which needed its own probe because they were passing for each other. **(3)** `INSERT OR REPLACE INTO observations (id, …)` rewrote an append-only snapshot in place — Law 9's third door, past both `no_update` and `no_delete`. **(4)** `followup_count` had **no writer anywhere in the tree**, so the one-follow-up policy was decorative.

*Delivered*: the calibration half — 32 operator handles added through the real `/add` path, the Apify actor wired end to end (run/poll/dataset client banking Apify's own `usageTotalUsd` receipt, alias-tracking mapper where absent reads null rather than a confident zero, `≤$2` smoke door vs a scale door that refuses while selection is DRAFT), `npm run keys` presence-only reporting, private accounts scored X deterministically with no paid call. Then Part X.2 entire: census tripwire, `state:export` / `state:restore` / `state:verify`, `npm run forget` with tombstones, ratify write-through, and `lib/assertions.ts` extracted so restore can gate itself mid-transaction.

*Also fixed*: few-shot ordered "recent decisions" by rowid rather than decision time — identical in normal operation, divergent under any restore, and it would have silently recalibrated the scorer against a different five of Conner's judgments.

*Ratified into canon*: the committed/not-committed principle, verbatim, with its Law 5 second-clause reasoning (Part 2.3) · the four restore constraints (Part X.2) · the follow-up counting rule (Part 8.2) · forget + tombstones, including the honest note that a handle fingerprint is pseudonymous, not anonymous · write-through discipline · gateway-vs-provider 403 classification by response author · `followerCount` as `number | null` · metric-free packets write no Observatory row · private account = deterministic X with a null `score_prompt_version` as the permanent marker · actor selection as a DRAFT gate resolved only by a passed smoke test · alias tracking in the actor map.

*Verification*: 99 → 198 check assertions. Restore round-trips the live database exactly — every candidate column handle by handle, 57 history hops, and `buildFewShotBlock` **byte-identical** — is idempotent on a second run (32 observations skipped, zero written), and **rolls back entirely** on a snapshot that would mint judgment: a Law 10 breach was caught inside the transaction and left the target database at zero rows, which is the whole point on an append-only table. `npm run forget` erases a coach end to end (43→42 candidates, 32→31 observations, packet deleted, spend and harvest_runs untouched) and the tombstone then refuses their re-add while an unrelated handle still adds. Every new tripwire proven by reintroducing its defect, each branch separately.

**A3 — Harvest, build half · 2026-08-27 · shipped and RATIFIED; real providers now await keys only.** Commits: `966d374` build half · `+ A3 ratifications + canon update`.

*Delivered*: the Part IV adapter contract with all three adapters — 4a seller-exhaust (query library over metros, ≤5 pages, URL-dedupe, page resolution, handle/offer/price/tell extraction), 4b hashtag mining (actor-class, bios + follower counts arrive with the seed and write Observatory snapshots), 4c commenters (halts by canon design while the seed list is empty) · `lib/fetchLink.ts` to spec (1 req/s, 10s timeout, <500 chars ⇒ failed, never blocks) with a **Law 3 hard refusal of Instagram hosts** · ingest with in-run + cross-run dedupe, provenance stamping, harvest_runs + spend rows, budget gated BEFORE provider work · every external service behind fixture/real providers — fixture runs the whole flow offline tonight; real stubs halt naming their exact ask (SERPER_API_KEY / APIFY_TOKEN) and refuse to spend while libraries are DRAFT · `/settings` (estimate BEFORE confirm, run log, key presence, DRAFT gates, spend vs caps, run ledger) · `/metrics` per 8.4 pulled forward from A4 (per-source qualification, funnel, cost per qualified, DMs/day, reply rate — live data, honest em-dashes).

*Configs RATIFIED v1 (Part XV.8 red pen passed)*: `config/queries.ts` — the 4a starter set stands as-is for the first harvest; tuning comes from A4 measured data, not armchair edits · `config/hashtags.ts` — the 4b starter list stands; `VENUE_TAGS` stays empty by design until harvested bios teach us · `config/seeds.ts` — **empty is its ratified state**, carrying a PERMANENT gate ("seed list empty — Conner fills this") that halts seed harvest every time the list is empty, not merely until ratification. The check-suite assertions FLIPPED accordingly: a config regressing to DRAFT, a silently populated seed list, or a non-halting seed adapter now each turn the suite red.

*Also ratified*: the **Law 3 Instagram-host fetch refusal**, promoted from "canon implies" to explicit canon text in Law 3 and Part 4a — `lib/fetchLink.ts` throws on an IG host rather than skipping it, so a miswired adapter fails loudly.

*Inventions ratified into canon*: the routing refinement (now Part V's gate-routing clause — an existing pre-score always rules; eligibility is bio OR link_domain; bootstrap narrowed to rows with neither) · `CandidateSeed.profile` with Part IX snapshots · snapshot only when metrics were observed (now Part IX's write-discipline clause) · cost midpoints with worst-case estimates · $0.00 fixture spend rows carrying `est_cost` · returned-after-run log for fixtures, streaming with real wiring · first-IG-link-wins per SERP hit, testimonial @mentions ignored · `npm run export` stays in A4.

*Fixture defect caught by the new Law-7 assertion*: the A1 seed's `bulkbros.gym` carried `pre_score 18` while also being enriched and fully scored — a state the pipeline cannot produce, since 18 is a kill. Corrected to 46 (the cheap filter was uncertain; the full scorer caught the brand), which is what the two-stage design actually looks like.

*Verification*: 90 db-suite check assertions at build half, 99 after ratification (section 13 ratified-config gates + Part 4a template fidelity + Law 3 predicate + extraction probes + run-ledger integrity; new section 14 proves a prescore-killed row cannot re-enter ANY gate, across six row shapes; serp/actors cap halts in section 12) · 14-assertion fetchLink unit vs a loopback server (`npm run test:fetchlink`) · 15-assertion browser E2E over /settings + /metrics · fixture harvest → dedupe (in-run, cross-run, cross-adapter) → prescore pickup proven live · every halt path exercised (both keys, empty seed list, serp/actors/total caps) · each flipped and new tripwire proven by reintroducing its defect.

**A2 — Score + Ratify, build half · 2026-08-27 · shipped and RATIFIED; calibration awaits the operator.** Commits: `18e2385` build half · `+ A2 ratifications + canon update`.

*Delivered*: Part V enrich behind a provider interface (fixture/manual now, actor stubbed at a marked A3 wiring point; every enrichment writes an observation) · Part VI verbatim — `prompts/prescore_v1.md` and `prompts/score_v1.md` extracted programmatically from this document's 6.1/6.2 fences, `claude-haiku-4-5` / `claude-sonnet-4-6`, temp 0, fence-strip + one retry + `score_failed` flag, `score_prompt_version` stored · the Part 6.5 few-shot builder (≤10, balanced approve/reject, reasons carried) · Part X budget gates before every paid call, actual spend logged from API usage · `/ratify` per Part VII with the full keyboard (y/n/b/f/j/k/u), reason picker, every keystroke a `ratifications` row · `npm run pipeline`.

*Missing key behaviour*: without an Anthropic key (`ANTENNA_ANTHROPIC_KEY`, or `ANTHROPIC_API_KEY` as fallback) the pipeline completes enrichment, then halts at the scoring step with instructions naming exactly what to add. Never a crash, never a fake score.

*Verification*: 71 check assertions (new: prompts byte-identical to this document's fences · few-shot balance/exclusion properties · llm-cap and total-cap halts) · 19-assertion `/ratify` browser E2E · pipeline halt paths exercised live (no key · actor stub · both budget caps).

*Ratified into canon (all ten A2 deviations)*: ratify-undo edges `qualified/rejected/banked → sourced` (Part 8.2 above; ratify-surface-only) · drawer-vs-ratify split (`rejected` drawer-terminal, not graph-terminal) · undo deletes the erroneous `ratifications` row while `status_history` keeps the round-trip · `score_failed` column (check allowance beside `id`) · bootstrap enrichment for bio-less manual adds; harvest rows take the gate as written · RULES arithmetic recomputed server-side, model disagreement loses · prescore kill_reasons preserved in `evidence` · X-tier at the back of the queue · `<500 chars = failed` reserved for A3's live fetcher, provider packets stored as-is · flagged rows stay queued with a badge. Plus the decided item: **score_v2** — metro terms injected from config at render time (Part VI note), shipped before calibration so the golden set is built against v2 and never re-scored.

*Pricing measurement (vs Part 6.4's $40–75 estimate)*: measured from the actual prompt files at current first-party rates (haiku-4-5 $1/$5, sonnet-4-6 $3/$15 per MTok): 5,000 pre-scores ≈ $3.75 · 1,500 full scores ≈ $26.69 · campaign total ≈ $30.44, ≈ $35 with a 15% retry pad — **under the estimate's floor**, with ~2× headroom against the $75 llm cap. The estimate stands; no cap change proposed.

**A1 — Spine + Track · 2026-08-27 · shipped.** Branch `claude/antenna-blueprint-setup-ofcrkq`, pending merge to main. Commits: `4a38a17` blueprint onboarded · `6776aae` spine + track · `0b90d58` enum + handle tripwires hardened · `c17b75b` ratifications + canon update · `2a913d8` canon structure guard.

*Delivered*: Part III schema exactly (7 tables, 31 candidate columns, enums verbatim) · the Part 8.2 status machine · `/pipeline` (dense table, filters, funnel strip, row drawer) · `/add` (paste + CSV, dedupe on handle) · `npm run check` (Part 2.6) · `npm run backup` · 5 seed fixtures.

*Design decision*: the blueprint's guarantees are **SQLite triggers generated from `db/enums.ts` + `lib/status.ts` + `config/limits.ts`**, not app-layer checks — so they bind every writer including a raw `sqlite3` shell, and the database cannot drift from the TypeScript.

*Verification*: 60 check assertions · 47 browser assertions across three suites · transaction rollback and funnel math verified independently · `tsc` and production build clean.

*Bugs found and fixed* (6): a Drizzle subquery correlating on an unqualified `"id"`, which bound to `status_history.id` and gave every row the same days-in-status · `/add` splitting pasted prose on spaces into one candidate per word · an in-batch duplicate reported "added" twice · an `overflow-x:auto` wrapper silently breaking the sticky table header · the enum "verbatim" check being a vacuous substring scan · a `lower()`-based handle guard that folds ASCII only.

*Fixed after adversarial review* (9, five of them tripwires in the check suite itself): the Part 8.2 legality assertion imported `canTransition` from the module the DB trigger is compiled from, so graph drift stayed green — the graph is now transcribed by hand into `scripts/check.ts` · candidates minted mid-funnel are detected · `INSERT OR REPLACE` teleport is blocked at the DB (a candidate is born `sourced`) · `transitionStatus` now detects a genuinely missing history trigger instead of overwriting the previous row · a failing probe no longer aborts the suite before it reports · the drawer had no React `key`, so a previous candidate's LOI tier could ride onto the next and record T2 on a deal meant as T1 · a global Enter handler suppressed activation of every button and link · `normalizeLinkUrl` mis-parsed leading whitespace into hostname `https` · `seed --reset` re-inserted identical observation snapshots that Law 9 makes permanently undeletable.

*Canon integrity*: the blueprint's first transcription arrived with every blank line absent, which turned 14 of its `---` separators into setext H2 underlines and merged 30 paragraphs. It was re-transcribed from the intact source and verified byte-for-byte (`md5 b8cbeb43b697c155a6dcec37731c2864`, 507 lines, 122 blank). `npm run check:canon` now guards this structurally.

*Ratified into canon*: the two re-entry edges in Part 8.2 · genesis history row on insert · surrogate `id` PKs on the log tables · `harvest_runs.status` = `running|ok|failed` · status-priority sort with replies first · funnel conversions computed from "ever reached" in `status_history` · a font stack instead of `next/font` · `check:golden` reporting PENDING until A2 fixtures exist.

*Carries into A2*: `check:golden` is a stub until `golden/set.json` is hand-labeled; `/ratify`, `/metrics` and `/settings` are placeholders in the nav.

---

# PART I — IDENTITY, THESIS, AND THE LAWS

## 1.1 One breath
Antenna finds online fitness coaches who match Instar's exact founding-cohort profile, scores each one with evidence shown, drafts the one observation that makes a DM personal, and tracks every conversation from first message to signed LOI — while every harvest quietly accumulates a longitudinal dataset on the market Instar sells into. Conner sends every message himself.

## 1.2 The thesis
**Discovery is a data business wearing a software costume — so Antenna competes on qualification, not collection.** Commercial databases index hundreds of millions of profiles but cannot score our filter (under ~10K, visibly selling, DM-run, online-not-studio, metro fit). Their output is a haystack; Antenna's is a ranked shortlist with reasons.

**The inversion**: hunt *sellers*, filter for fitness — not the reverse. Active selling leaves public exhaust (Stan Store pages, Linktrees with offers, comment-word CTAs, "2 spots open" captions) that is indexable and searchable. Everyone entering through that door is already a seller, and the under-10K tier that databases index worst is who this method finds best.

## 1.3 The laws (bind every phase, every session)
1. **Antenna preps, never sends.** No automation ever touches a DM. Every message leaves by Conner's hand, adapted per person. (Assistant law, internal edition — and survival: Instagram bans DM automation, and the personal account is the campaign's only channel.)
2. **Never promise what the world controls.** Confidence is tiered: ~99% engineered on what we control (no lost data, no duplicate outreach, no wasted DM hours, caps holding) · ≥90% precision as a *tuned design target* on A-tier scoring · honest ranges on population, actor uptime, and Instagram's surface. The Ninth Law applies to our own tooling. **Both engineered claims were ASSERTED, not true, until A2-calibration** — and the Ninth Law says say so. *No lost data*: an empty database passed the whole check suite green, so amnesia was silent; now `state/census.json` makes it loud and `state:restore` makes it recoverable (Part X.2). *No duplicate outreach*: `followup_count` had no writer anywhere in the tree, so the one-follow-up guard bound a counter that never counted; `logOutreach` now derives it and `npm run check` asserts it agrees with the log.
3. **No direct scraping of Instagram from any infrastructure or account we own. No session cookies, ever, to any service.** Instar's roadmap depends on Meta API goodwill; commercial data services carry collection risk, we buy structured public data. **Enforced, not merely intended (ratified A3)**: `lib/fetchLink.ts` REFUSES Instagram hosts outright — a fetch aimed at `instagram.com`, any subdomain, or `instagr.am` throws rather than skipping, so a miswired adapter fails loudly instead of quietly breaching the law. `npm run check` asserts the refusal predicate directly. Instagram-side data reaches us only through commercial actors, whose infrastructure carries the collection risk; an `instagram.com` SERP hit is read from its URL and snippet alone and never resolved.
4. **Provenance on every row.** Source, query, fetch date. Dirty sources are traceable and disposable.
5. **Public business signals only.** Handles, bios, offer pages, posting behavior. No personal-life data, no contact harvesting beyond what a business publishes, no resale, trivial delete-on-request. **The two clauses are independent (ratified A2-calibration)**: the whitelist licenses what may be COLLECTED, the handling clause constrains WHERE it may be held — which is what puts harvested content out of git history (Part 2.3) and keeps the person-linked snapshot in the operator's hands. **And delete-on-request is now a capability, not a promise**: `npm run forget -- <handle>` erases a person from every place the system holds them, with a tombstone so the next harvest does not simply collect them again (Part X.2).
6. **Budget caps live in code.** The pipeline halts itself; overspend is structurally impossible.
7. **The tool never blocks the campaign.** Every module is useful alone; the floor outcome (manual harvest + Score + Track) still beats the status quo.
8. **Separate estate.** Never touches ficm, its repo, its checks, or its deploy pipeline. Verify the git remote before any push.
9. **Observations are append-only.** Snapshots accumulate; nothing overwrites history. (The Observatory law.)
10. **A candidate becomes DM-able only through human ratification.** The queue is the taste gate, industrialized.

## 1.4 Success criteria (v1 done means)
≥350 A/B-tier candidates across both metros within 2 weeks of A4 · ≥60% A-tier survival through the ratify queue at first, **≥90% after tuning** (golden set enforced) · 100% of outreach tracked with timestamps · total external spend ≤ $250 · zero account-safety incidents.

---

# PART II — ARCHITECTURE, STACK, REPO

## 2.1 The spine
```
HARVEST (adapters) ──► candidate pool (deduped, provenance-stamped)
                              │
                     PRE-SCORE (cheap model, bio-only) ──► kills obvious noise
                              │  (threshold gate)
                        ENRICH (IG profile data + link-page fetch)
                              │            └──► OBSERVATION snapshot (append-only)
                      FULL SCORE (capable model, rubric, evidence, hook)
                              │
                       RATIFY QUEUE (human, keyboard) ──► ratifications (few-shot fuel)
                              │
                         TRACK (funnel CRM: DM → reply → call → demo → LOI → signed)
```

## 2.2 Stack (exact)
- **Next.js + TypeScript, App Router** (the known stack) · **no UI kit** · React latest stable
- **SQLite** file DB (`./antenna.db`) via **Drizzle ORM** + `better-sqlite3` · migrations via drizzle-kit, never hand-edit the DB
- **tsx** for pipeline scripts (runnable from UI buttons and CLI)
- **Anthropic API** for scoring: `claude-haiku-4-5` (pre-score), `claude-sonnet-4-6` (full score), temperature 0, JSON-only outputs
- **Serper.dev-class SERP API** (Google Programmable Search as fallback) · **Apify-class data actors** for IG-side pulls
- Design law **relaxed** (internal cockpit): borrow the Instar palette for speed — navy `#1B2A4A`, ink `#16181D`, hairline `#E9EAF0`, Inter 400/500/600, tabular numerals on all counts. Density over polish.

## 2.3 Repo layout
```
antenna/
  app/                    # Next.js routes: /pipeline /ratify /add /metrics /settings
  components/             # hand-built kit (Table, Drawer, Chip, StatCard, KeyHint)
  db/schema.ts            # Drizzle schema (Part III is canon)
  db/migrations/
  pipeline/
    harvest/serper.ts     # 4a seller-exhaust
    harvest/hashtags.ts   # 4b
    harvest/commenters.ts # 4c (stretch)
    enrich.ts             # 5
    prescore.ts  score.ts # 6
    lib/{budget,dedupe,provenance,fetchLink}.ts
  prompts/prescore_v1.md  score_v1.md  fewshot.ts
  config/metros.ts        # term + hashtag libraries (Part 4.5) — metros are CONFIG, not code
  config/limits.ts        # caps, thresholds, pacing numbers
  golden/set.json         # frozen labeled profiles (Part 6.6)
  scripts/{backup,export,check,check-golden}.ts
  .env.local              # keys — gitignored
```
`.gitignore`: `antenna.db*`, `.env*`, `/backups`, `/profiles`, `/state/snapshot.json`.

**THE COMMITTED/NOT-COMMITTED PRINCIPLE (ratified, A2-calibration).** The canon drew this line by example for three phases without ever stating it, which is why there was no rule to appeal to when durability arrived. Stated:

> **Our own decisions, labels, ledgers and provenance may be committed. Third-party harvested content — bios, captions, link-page text — never enters git history.**

The reasoning is Law 5's *second* clause, not its first. Law 5's whitelist ("handles, bios, offer pages, posting behavior") licenses **holding** that data; the handling clause — **"trivial delete-on-request"** — independently constrains **where** it may be held. Deleting a row from a file the operator holds is trivial. Deleting it from git history is a history rewrite, and calling that trivial would be the kind of claim the Ninth Law forbids. So `golden/set.json` (our tier labels), `state/census.json` (counts and money) and `state/tombstones.json` (fingerprints) are committed; `state/snapshot.json` and `/profiles` are not, and leave the container by being handed to the operator.

## 2.4 Bootstrap (A1 prompt executes this)
Private GitHub repo `antenna` → `create-next-app` (TS, App Router, no Tailwind config beyond tokens in globals) → install `drizzle-orm better-sqlite3 drizzle-kit tsx @anthropic-ai/sdk` → schema → migrate → seed → run.

## 2.5 Environment
`.env.local`: `ANTENNA_ANTHROPIC_KEY` · `SERPER_API_KEY` · `APIFY_TOKEN`. Personal accounts (governance, Part XII). Keys never committed, never echoed in logs. The Anthropic slot accepts two names in priority order — `ANTENNA_ANTHROPIC_KEY` is canonical because the deploy platform filters the reserved `ANTHROPIC_API_KEY`, which stays accepted as a fallback for local machines.

## 2.5b External services (the complete dependency list — four accounts, personal email + card)
| Service | Role | Cost (campaign) | Needed by |
|---|---|---|---|
| **Serper.dev** (fallback: Google Programmable Search, 100 free/day then $5/1K) | SERP API for seller-exhaust queries | Free starter credits, then ~$1/1K searches → ~$10–25 | Phase A3 |
| **Apify** (alt: Bright Data / EnsembleData-class) | IG-side pulls via hosted actors — *their* infra carries collection risk; we buy structured public data | Small free credit, then ~$1–3/1K profiles → capped $100 | Phase A3 |
| **Anthropic API** (console.anthropic.com — separate from Claude subscriptions) | Pre-score (Haiku) + full score (Sonnet) | Pay-as-you-go → ~$40–75 | Phase A2 |
| **GitHub personal** | Private `antenna` repo, separate from the M&S Bitbucket estate | $0 | Phase A1 |

Nothing else needs an account: SQLite is a local file, there is no hosting, backups use the existing iCloud folder. **Deliberately absent** (laws, not oversights): no scraping libs/headless browsers aimed at Instagram from owned machines or IPs (Law 3) · no session cookies to any service (Law 3) · no DM automation of any kind (Law 1) · no influencer-database subscription (the category Antenna replaces; one emergency month is a last-resort fallback only). Clarification logged: ManyChat-class comment-to-DM tools are Meta-approved and belong to the *coach product's* capture playbook later — coaches automating their own inbound with their own words — never to our outbound.

## 2.6 The check suite (`npm run check`)
Schema validates · handle uniqueness holds · every candidate carries `source + first_seen` · every status change has a `status_history` row · `signed` requires `loi_tier` · observations are append-only (no UPDATE path exists) · spend sum ≤ cap · `npm run check:golden` (Part 6.6) passes. Runs green or nothing ships — the ficm discipline, ported.

---

# PART III — DATA CANON (the schema)

Enums first — exact strings, everywhere:
- `status`: `sourced | qualified | dmed | replied | no_response | call_booked | demo_given | loi_sent | signed | declined | rejected | banked`
- `tier`: `A | B | C | X` · `loi_tier`: `t1 | t2 | t3` · `metro`: `nyc | sofla | other | unknown`
- `decision` (ratify): `approve | reject | bank | flag` · `link_fetch_status`: `ok | failed | skipped`

**candidates** — `id` · `handle` (unique, lowercased; **the dedupe key**) · `ig_url` · `name` · `follower_count` · `bio` · `link_url` · `link_domain` · `link_contents` (text) · `link_fetch_status` · `metro` · `metro_confidence` (0–1) · `source` · `source_detail` · `first_seen` · `last_enriched` · `pre_score` · `score` · `tier` · `score_prompt_version` · `evidence` (json string[]) · `hook_draft` · `stack_signals` (json — e.g. `["stan_store","venmo_mention","klarna"]`) · `extracted` (json: name, offers[{type,price?}], lead_magnet?) · `status` (default `sourced`) · `followup_count` (default 0) · `loi_tier` · `notes` · `next_action_date` · `created_at` · `updated_at`

**status_history** — `candidate_id, from_status, to_status, at, note`. Written on every transition, no exceptions.

**ratifications** — `candidate_id, decision, reason, at`. **This table is the training data**: the few-shot loop reads it (6.5).

**harvest_runs** — `adapter, params(json), started_at, finished_at, items_found, items_new, est_cost, status, error`. Provenance + per-source qualification metrics + cost ledger feed.

**outreach_log** — `candidate_id, direction(out|in), text, at`. What was actually sent/received — later enables reply-rate-by-opener learning.

**observations** — `handle, observed_at, follower_count, posts_30d, format_mix(json), engagement_proxy, source`. **Append-only.** Every harvest and enrichment writes a snapshot (Part IX).

**spend** — `at, category(serp|actors|llm), amount, run_ref, note`. `SUM(amount)` checked against the cap before every paid operation.

Secondary dedupe: normalized `link_url` — two candidates sharing a link page get flagged for manual merge, never auto-merged.

---

# PART IV — HARVEST (adapters in full)

**Adapter contract** — every adapter exports `{ name, run(params): Promise<CandidateSeed[]> }` with `CandidateSeed = { handle?, ig_url?, link_url?, raw_evidence, source, source_detail }`. The pipeline dedupes, stamps provenance, inserts as `sourced`. A broken adapter is swapped, not mourned.

## 4a. Seller-exhaust search (PRIMARY — most robust, most novel)
SERP queries against the public footprints of selling. Parse organic results → resolve each hit's page → extract IG handle (`instagram.com/<user>` links, `@handle` text), offers, price patterns (`$NNN`), platform tells.

**The query library** — `config/queries.ts`, **RATIFIED v1 (A3)**: the starter set below stands as-is for the first harvest; tuning comes from A4's measured-run data, not from armchair edits. `npm run check` asserts the config matches this list exactly, so a future edit is a canon-and-config change together. Combinatorial over `config/metros.ts` terms; log every query in `harvest_runs.params`:
```
site:stan.store ("online coach" OR "coaching") {metro_term}
site:stan.store (fitness OR "personal trainer") {metro_term}
site:linktr.ee "online fitness coach" {metro_term}
site:linktr.ee ("apply" OR "coaching application") fitness {metro_term}
site:beacons.ai fitness coach {metro_term}
site:instagram.com "online coach" "{metro_term}" ("comment" OR "DM me")
site:instagram.com fitness coach "{metro_term}" ("spots open" OR "apply")
"1:1 coaching" fitness "{metro_term}" ("stan.store" OR "linktr.ee")
```
Pagination to ~5 pages/query max. Dedupe on result URL before fetching. A Stan Store hit is **double gold**: proof of selling *and* the exact duct-tape stack the pitch attacks.

**Link-page fetch** (`lib/fetchLink.ts`): polite plain fetch, 1 req/sec, 10s timeout. If the body yields <500 chars of text (JS shell), set `link_fetch_status=failed` and continue — the candidate is still scoreable from IG data alone at lower confidence. Optional later fallback: a rendering-service actor. Never block on it. **Law 3 clause (ratified A3)**: the fetcher refuses Instagram hosts by predicate and throws on one — it is the enforcement point of "no direct scraping from infrastructure we own", not a place that merely avoids IG by habit. The <500-char rule diagnoses LIVE fetches only; provider-supplied packet text is stored as given, so a genuinely short link page is never discarded as a JS shell.

## 4b. Hashtag + location mining (SECONDARY)
Via commercial data actors, **no login**. Actor names churn: the builder selects currently-maintained "Instagram hashtag scraper" / "Instagram profile scraper"–class actors and **smoke-tests each with a ≤$2 run before any scale run**. Inputs from `config/metros.ts`; outputs mapped to CandidateSeed; expect flakiness and let Score do the filtering.

**Starter hashtag library** — `config/hashtags.ts`, **RATIFIED v1 (A3)** (expand from observed bios; log expansions):
`#onlinefitnesscoach #onlinecoach #fitnesscoach #nutritioncoach` × metro: `#nycfitnesscoach #nycpersonaltrainer #nycfitness #brooklynfitness #manhattanfitness #miamifitnesscoach #miamipersonaltrainer #miamifitness #fortlauderdalefitness #bocaratonfitness #westpalmbeachfitness #southfloridafitness`

Location-tag feeds for marquee gyms/studios per metro: build the venue list from what harvested bios actually tag (data over guessing). **Ratified A3: `VENUE_TAGS` is EMPTY BY DESIGN** and stays empty until harvest data fills it — populating it before the first run would be exactly the armchair guess this rule exists to prevent. `npm run check` asserts it stays empty until the data exists.

## 4c. Commenter / tagged harvesting (STRETCH — bonus tier)
Follower-list scraping is the flakiest actor class and often demands cookies (banned — Law 3). Sturdier graph proxies, no login: **commenters and tagged/collab accounts on a seed list** of 10–20 local coaches per metro (sourced from 4a/4b's best finds + Christopher's orbit, post-confirmation). Precision is low by design; the pre-score absorbs it.

**The seed list is ratified EMPTY (A3)** — `config/seeds.ts` ships with no handles, and empty is its *correct* state, not an unfinished one. It carries a **permanent gate**: seed-based harvest halts with *"seed list empty — Conner fills this"* whenever a metro's list is empty, every time, not once. Only Conner adds handles; the builder never does, because a guessed seed list would poison the very graph-proxy sample it exists to make trustworthy.

## 4d. Manual add (ALWAYS ON)
`/add`: paste handles/URLs (one or many) or CSV. Runs the full enrich/score pipe. **Every Christopher warm intro enters here** — warm intros skip Harvest, never skip Track.

## 4.5 `config/metros.ts` (starter)
```
nyc:   ["NYC","New York","Manhattan","Brooklyn","Queens","Bronx","Jersey City",
        "Hoboken","Long Island","Westchester"]
sofla: ["Miami","Fort Lauderdale","Boca Raton","West Palm Beach","Palm Beach",
        "Delray","Wynwood","Brickell","South Florida"]
```
Wave three = add a config block. Metros are configuration, never code.

## 4.6 Platform scope (ratified reasoning — mirrors doc 14 §6)
**Instagram-first, deliberately.** (1) The outreach channel: cold DMs are a normal business event on IG and structurally broken on TikTok (mutual-follow defaults, buried request folders) — even TikTok-native coaches get pitched on Instagram. (2) Product fit: the strategist launches IG-only (doc 14 ratification) and the entire demo canon is Instagram; recruiting TikTok-first founding coaches sells ahead of the product's own scope — the Ninth Law applied to our own recruiting. (3) The restriction is nearly costless: the seller-exhaust door is platform-agnostic — link pages list every social, and TikTok-heavy coaches who actually *sell* maintain the IG side because that's where the funnel lives (TikTok discovers, Instagram converts).

**Passive capture**: when a link page or bio reveals a TikTok presence, record it — `extracted.tiktok_url` and `"tiktok_presence"` in `stack_signals`. Strong TikTok + IG DM funnel is a *premium* signal: those coaches are the natural test bed for the product's Phase F TikTok fast-follow. A TikTok harvest adapter is a future bolt-on under the adapter contract — never a v1 scope item.

---

# PART V — ENRICH

Runs **only** on candidates with `pre_score ≥ PRESCORE_THRESHOLD` (default 40, `config/limits.ts`).

**Gate routing (ratified A3)**: an existing `pre_score` ALWAYS rules — a candidate the cheap filter killed can never reach paid enrichment through any other door. Pre-score eligibility is `bio OR link_domain` (a `stan.store` domain alone is real signal, so harvest-sourced rows take the cheap filter first, as the spine intends). The bootstrap exception is narrowed to rows carrying *neither* — the manual adds of Part 4d, where there is genuinely nothing for the pre-filter to read. `npm run check` asserts every killed-row shape stays out of every gate: the leak it guards (a killed row re-entering via the bootstrap door) is precisely the class Law 7 exists for.

Fetches: IG profile packet via profile-scraper-class actor (bio, follower count, ~last 6 posts' captions + types + rough engagement) + the link page (4a's fetcher, if not already fetched). Writes `last_enriched`, populates enrichment fields, **and writes an observation snapshot** (Law 9). Re-enrichment is on-demand only (a button in the drawer), never automatic — staleness is acceptable for prospecting; the observatory captures deltas when re-runs happen.

---

# PART VI — SCORE (rubric, prompts, math)

## 6.1 Stage 1 — pre-score prompt (`prompts/prescore_v1.md`, verbatim)
```
You are a strict pre-filter for a prospecting pipeline. Target profile: individual
online fitness/nutrition coaches who SELL coaching (not gyms, apparel brands,
athletes, meme pages, or gym-floor-only trainers), roughly 500–20,000 followers.

Given: handle, bio, follower_count, link_domain.
Return ONLY JSON: {"pre_score": 0-100, "kill_reasons": string[]}

Score 0–20 if: clearly a gym/brand/media page; athlete or model with no coaching
offer; follower_count > 60,000 or < 200; no hint of coaching in bio or link.
Score 60+ only if: an individual, coaching-adjacent language, plausible size band.
When uncertain, score 45–55 (let the full scorer decide). No prose. JSON only.
```
Model `claude-haiku-4-5`, temp 0. Cost ≈ negligible per profile.

## 6.2 Stage 2 — full-score prompt (`prompts/score_v1.md`, verbatim)
```
You score prospects for Instar, a business platform for online fitness coaches.
IDEAL: individual online coach, 1K–10K followers, actively SELLING coaching
(offers/prices/application visible), business visibly run through DMs
(comment-word CTAs, "DM me", link-funnels ending in DMs), based in {NYC metro}
or {South Florida}, posted within 30 days.

INPUT: handle, bio, follower_count, last ~6 captions, link page text, tags.

RETURN ONLY JSON:
{"gates":{"sells_online_coaching":{"pass":bool,"evidence":str},
          "is_individual_coach":{"pass":bool,"evidence":str},
          "alive_30d":{"pass":bool,"evidence":str}},
 "dims":{"dm_run":{"pts":0-25,"evidence":str},
         "size_band":{"pts":0-20,"evidence":str},
         "metro":{"metro":"nyc|sofla|other|unknown","confidence":0-1,
                  "pts":0-15,"evidence":str},
         "online_purity":{"pts":0-15,"evidence":str},
         "activity":{"pts":0-10,"evidence":str},
         "engagement_proxy":{"pts":0-5,"evidence":str}},
 "penalties":{"incumbent_tooling":{"pts":0 to -10,"evidence":str}},
 "stack_signals":string[], 
 "extracted":{"name":str,"offers":[{"type":str,"price":str|null}],
              "lead_magnet":str|null},
 "hook_draft":str,
 "score":0-100,"tier":"A|B|C|X"}

RULES: Any failed gate => tier X, score as computed but capped 39. Otherwise
score = sum(dims) + 10 base + penalties. Tiers: A >= 75, B 55-74, C 40-54.
Size band: 1K-10K full points; 500-1K or 10-20K half; outside quarter.
Metro: explicit bio/location evidence = high confidence; caption/tag hints =
medium; none = "unknown", 0 pts (NOT a rejection).
Evidence strings must quote or closely paraphrase the actual source text.
HOOK_DRAFT: one sentence, a note TO THE OPERATOR (not message copy), naming ONE
concrete observable — a specific post, offer, program name, or funnel detail —
that a first message could reference. No flattery, no AI mention.
Examples of good hooks:
- "His Stan page leads with a $1,200 yearly-upfront option — same model as ours."
- "Runs a 'comment LEAN' guide funnel on 3 of her last 5 posts."
- "Pinned a 16-week client transformation from March; still his top post."
{FEW_SHOT_BLOCK}
No prose. JSON only.
```
Model `claude-sonnet-4-6`, temp 0. Strip code fences, parse; on invalid JSON retry once, then flag `score_failed` for manual review. Store `score_prompt_version` on the row.

**score_v2 (ratified A2)** = score_v1 with the `{NYC metro}` / `{South Florida}` placeholders rendered from `config/metros.ts` at assembly time, exactly like `{FEW_SHOT_BLOCK}`. The prompt file on disk stays byte-identical to the fence above; metros remain configuration, never prompt text (Part 4.5), so wave three is still just a config block. `npm run check` asserts the rendered prompt carries every metro term from config and leaves no placeholder unrendered.

## 6.2a Eligibility gates — before anything is paid for (ratified, A2 close)

A rubric dimension is a judgement with points attached, and the three gates in the 6.2 fence are judgements the model makes. **An eligibility gate is not that.** It runs in code, before any paid call, and forces tier X without the model being consulted — because some findings are not a quantity to be weighed against a good DM funnel.

- **A minor is ineligible.** Any indication that the account holder is under 18 is an automatic X, prior to scoring. Not a rubric line, not a penalty, not something a strong funnel can outweigh.

**The precedent case** is #17 in the A2 ratify pass. `@tommy_lifts10`'s bio opens *"16y / I want to inspire you"*. The pre-score noticed — *"Age indicator (16y) suggests minor"* — but **noticing is not a gate**: the profile was full-scored anyway, cost sonnet money, and arrived at `/ratify` as a judgement call rather than as an ineligibility. The operator rejected it and ruled that this must never be a judgement call again.

**False positives are the expensive direction**, so the detector is deliberately narrow. *"17 years experience"* is an adult coach's credential, *"16 week program"* is an offer, *"10–16 reps"* is programming and *"2016"* is a year — each would be a real prospect silently deleted with no model call and no evidence anyone would think to question. So the rule is: match age markers that can only be ages, and stand down wherever the surrounding words say duration. Captions are **not** scanned — *"my 16 year old client"* is an adult's sentence. `npm run check` §19 carries ten stand-down cases alongside the catches, and the gate fires on exactly one of the 43 real candidates in the database: the precedent case.

The row still enters `/ratify` with its reason in `evidence`, exactly as a private account does, and `score_prompt_version` stays NULL — the marker that no prompt ran. The operator keeps the last word; what they no longer have is a bill for it.

## 6.3 Tier semantics
**A** = DM this week · **B** = DM after A-tier exhausts · **C** = revisit only if funnel starves · **X** = gated out (visible reasons preserved). Metro `other/unknown` with strong everything-else → ratify decision `bank` → status `banked` (wave-three inventory, never waste).

## 6.4 Cost model
~5K pre-scored → ~1.5K enriched + full-scored ≈ **$40–75 LLM total** (two-stage exists so the capable model never reads noise). Logged to `spend` per run.

## 6.5 The few-shot loop (the cheapest possible learning)
`prompts/fewshot.ts` builds `{FEW_SHOT_BLOCK}` from the **ratifications** table: up to 10 recent decisions, balanced approve/reject, each rendered as a compact labeled example with Conner's reason. Every ratification makes the scorer more Conner-shaped. No fine-tuning theater.

## 6.6 The golden set (`golden/set.json` — scoring's regression test)
During A2, hand-label **30 frozen profiles** (≈10 clear-A, 10 B/C, 10 X) with expected tiers. `npm run check:golden` re-scores the set against the current prompt+few-shot and asserts **≥90% tier agreement on A-vs-not-A**. Run after every prompt or few-shot change. This is how "tune the rubric" never silently becomes "break the rubric."

**Built, 2026-08-30 — and split in two (ratified).** The set was frozen from the 32-profile calibration batch at the operator's ratify pass. Part 6.6 wants *frozen* inputs — a regression test whose inputs drift is not a regression test — but the scorer's input is a bio and six captions, which is person-linked, while Part 2.3 lists `golden/set.json` as **committed** and describes it as *"our tier labels"*. Those fit together exactly one way:

- **`golden/set.json`** — a handle **fingerprint**, the operator's decision, the transcribed expected tier, and the score at freeze time. Person-free, **committed**, so the regression contract is versioned with the code that it guards.
- **`golden/inputs.json`** — the frozen scorer input keyed by the same fingerprint. Person-linked, therefore **gitignored**, carried by the Part X.3 store, and purged by `npm run forget` like every other copy. Committing it would put a coach's bio in git history, where "trivial delete-on-request" becomes a history rewrite.

**The tiers are transcribed, not derived** — written out by hand from the verdicts, exactly as `check.ts` transcribes `CANON_TRANSITIONS` rather than importing `lib/status.ts`. A golden set built by `SELECT`ing the tiers the scorer produced could only ever agree with the scorer, and would catch nothing.

**Two modes, because this is chained into `npm run check`.** A live re-score is 32 frontier calls — real money, and it needs a key — so the default compares the **stored** scores to the labels with no model calls, and `--rescore` does the canon re-score through the current prompt and few-shot block. Only `--rescore` can see a prompt edit, so that is the one to run after changing one.

`bank` and `flag` are frozen but **excluded from the metric**: a banked profile is a real coach held for a later wave, and scoring that as a failure would train the rubric to reject good coaches for being early.

## 6.7 Stage 1 — pre-score prompt v2 (`prompts/prescore_v2.md`, verbatim)

Ratified 2026-08-30 with the NATIONAL founding-cohort decision. The hardcoded 500–20,000 band and the `> 60,000` auto-kill are gone: they were killing the target. Size below the ceiling is now a matter of degree for the full scorer, never a kill here.

```
You are a cheap first-pass filter for Instar, a business platform for online
fitness coaches. Decide whether a profile is worth a full, expensive scoring
pass. The founding cohort is NATIONAL — location is never a reason to kill.

Kill the obvious noise: gyms and studios rather than individuals, supplement
and apparel brands, meme and repost pages, talent-agency-managed lifestyle
influencers with no coaching offer, and gym-floor-only trainers with no online
business.

SIZE IS NOT A KILL. Anyone from 500 to about 1,000,000 followers is worth a
full look. Below 500 there is no business yet; above ~1,000,000 the account is
a media property rather than a coach taking DMs. Between those, follower count
is a matter of degree for the full scorer to weigh, NEVER a reason to kill
here. A 40,000-follower coach selling 1:1 in the bio is exactly the target.

Given: handle, bio, follower_count, link_domain.

Return ONLY JSON: {"pre_score":0-100,"kill_reasons":[str]}

Score high when the bio names a coaching offer, an application, a DM keyword,
a niche and who it is for, or the link points at a coaching funnel
(stan.store, a personal coaching domain, an application form).
Score low for brand accounts, agency contacts with no offer, dormant or
abandoned accounts, and profiles with no coaching signal anywhere.
kill_reasons carries the specific disqualifying signals you actually saw —
never "too big" or "too small" for anything inside the range above.
When uncertain, score 45-55 (let the full scorer decide). No prose. JSON only.
```

Model `claude-haiku-4-5`, temp 0. Cost ≈ negligible per profile.

## 6.8 Stage 2 — full-score prompt v2 (`prompts/score_v2.md`, verbatim)

Ratified 2026-08-30. `metro` 15 → 5 and reframed as a bonus; the freed 10 points split 7/3 to `dm_run` and `online_purity` on the calibration evidence; `size_band` rebuilt from the operator's verdicts and **computed in code** from `config/limits.ts` rather than asked of the model. Stored as `score_prompt_version = score_v3` — the version counts rubric revisions and `score_v2` was already spent on the v1-file-plus-metro-injection rendering, so file and version are deliberately off by one.

```
You score prospects for Instar, a business platform for online fitness coaches.
IDEAL: individual online coach actively SELLING coaching (offers/prices/
application visible), business visibly run through DMs (comment-word CTAs,
"DM me", link-funnels ending in DMs), posted within 30 days. The founding
cohort is NATIONAL: location is a convenience, never a requirement.

INPUT: handle, bio, follower_count, last ~6 captions, link page text, tags.

RETURN ONLY JSON:
{"gates":{"sells_online_coaching":{"pass":bool,"evidence":str},
          "is_individual_coach":{"pass":bool,"evidence":str},
          "alive_30d":{"pass":bool,"evidence":str}},
 "dims":{"dm_run":{"pts":0-32,"evidence":str},
         "size_band":{"pts":0-20,"evidence":str},
         "metro":{"metro":"nyc|sofla|other|unknown","confidence":0-1,
                  "pts":0-5,"evidence":str},
         "online_purity":{"pts":0-18,"evidence":str},
         "activity":{"pts":0-10,"evidence":str},
         "engagement_proxy":{"pts":0-5,"evidence":str}},
 "penalties":{"incumbent_tooling":{"pts":0 to -10,"evidence":str}},
 "stack_signals":string[], 
 "extracted":{"name":str,"offers":[{"type":str,"price":str|null}],
              "lead_magnet":str|null},
 "hook_draft":str,
 "score":0-100,"tier":"A|B|C|X"}

RULES: Any failed gate => tier X, score as computed but capped 39. Otherwise
score = sum(dims) + 10 base + penalties. Tiers: A >= 75, B 55-74, C 40-54.
DM_RUN is the heaviest dimension (0-32) and the one that most separates a real
prospect from a lookalike: comment-word CTAs, "DM me X", application funnels,
a stated 1:1 offer. Score it on evidence you can quote, not on vibes.
Size band: 3K-80K full points; 500-3K or 80K-150K partial; larger tapers to
almost nothing. It is COMPUTED from follower_count, so report your reading and
expect it to be replaced by the arithmetic.
Metro: a BONUS ONLY (0-5) — same-metro adds reach-out ease, nothing more. It is
NEVER a gate and NEVER a reason to downgrade. {NYC metro} or {South Florida}
= 5; anywhere else, including unknown, = 0 and that is a normal, healthy score
for an ideal national prospect.
Evidence strings must quote or closely paraphrase the actual source text.
HOOK_DRAFT: one sentence, a note TO THE OPERATOR (not message copy), naming ONE
concrete observable — a specific post, offer, program name, or funnel detail —
that a first message could reference. No flattery, no AI mention.
Examples of good hooks:
- "His Stan page leads with a $1,200 yearly-upfront option — same model as ours."
- "Runs a 'comment LEAN' guide funnel on 3 of her last 5 posts."
- "Pinned a 16-week client transformation from March; still his top post."
{FEW_SHOT_BLOCK}
No prose. JSON only.
```

Model `claude-sonnet-4-6`, temp 0. Tier cuts unchanged (A ≥ 75 · B 55–74 · C 40–54): the national CEILING was broken under v1, not the cuts.


---

# PART VII — RATIFY QUEUE (`/ratify`)

Left: queue card (handle, tier+score, followers, metro chip, hook). Right: full evidence panel — every rubric line with its quoted evidence, link-outs to the IG profile and link page.

**Keyboard** (target: 100 profiles in ~20 minutes): `y` approve → `qualified` · `n` reject → reason picker (`not-a-coach / gym-floor / not-selling / too-big / too-small / dead / other`) → `rejected` · `b` bank (right coach, wrong/unknown metro) → `banked` · `f` flag for a closer look · `j/k` navigate · `u` undo last. Every keystroke writes a **ratifications** row — decisions are the tuning fuel (6.5).

---

# PART VIII — TRACK (the funnel CRM)

## 8.1 `/pipeline`
Dense table: handle · tier+score · metro · followers · status · days-in-status · next action · followups. Default sort: status-priority then score desc. Filters: status, tier, metro, source. Row → right drawer: evidence, hook, notes, outreach log, status controls, share-link generator, link-outs. Funnel strip on top: counts per status + stage-to-stage conversion %.

## 8.2 The status machine (allowed transitions only — enforced)
```
sourced ─(ratify y)→ qualified ─→ dmed ─→ replied ─→ call_booked ─→ demo_given ─→ loi_sent ─→ signed
   │(ratify b)→ banked                │└──────────────── declined (they said no, any stage)
   │(ratify n)→ rejected              └→ no_response (after 1 follow-up + 7 more quiet days)

Re-entry edges (ratified A1) — manual, via the drawer only, never automated:
   no_response ─→ replied     a ghost who answers late; the funnel resumes at replied
   banked ─────→ qualified    wave-three activation: banked inventory enters the live funnel

Ratify-undo edges (ratified A2) — the ratify queue's `u` ONLY; the drawer never offers them:
   qualified ──→ sourced      undo an erroneous `y`
   rejected ───→ sourced      undo an erroneous `n`
   banked ─────→ sourced      undo an erroneous `b`
```
- `rejected` = **we** disqualified · `declined` = **they** said no. Never conflate.
- **Re-entry (canon, ratified A1)**: `no_response → replied` and `banked → qualified` are the only ways back into the live funnel. Without them a late reply has no legal move and `banked` is dead stock — both violations of Law 7, and Part 2.2 forbids hand-editing the DB.
- **Ratify-undo (canon, ratified A2)**: Part VII's `u` (undo last) is realized as the three edges above — the only legal mechanism, since Part 2.2 forbids hand-editing the DB. They are **ratify-surface-only**: legal in the graph and in the DB trigger, never offered by the pipeline drawer, so undo can never become a general demotion path. An undo deletes the erroneous `ratifications` row (a mis-keystroke must not train the few-shot loop, Part 6.5) while `status_history` keeps the round-trip. Consequently `rejected` is drawer-terminal but not graph-terminal; the graph-terminal states are `signed` and `declined`.
- **Follow-up policy (canon)**: exactly **one** follow-up per candidate, 5–7 days after the DM, then `no_response`. Never a third touch — respect *and* account safety. `followup_count` enforces it. **The counting rule (ratified A2-calibration), because "enforces it" was not true**: the trigger refused `followup_count > 1` while nothing in the tree ever incremented the column, so the guard bound a counter that never counted. The rule, stated once: **outbound #1 is the DM, so `followup_count = max(0, outbound_count − 1)`**, recomputed by `logOutreach` from the log itself rather than incremented blindly — a counter derived from the record cannot drift from it — and `npm run check` asserts the two agree for every candidate.
- `signed` **requires** `loi_tier`: **T1** signature-only · **T2** + stated beta commitment · **T3** + deposit.

## 8.3 The DM composer (inside the drawer — the tool preps, never sends)
Shows: the hook_draft + the doc-08 canon opener **as raw material** under a permanent rule banner — *"Adapt every one. Never blast identical text."* · a share-link generator that outputs `instar.fit/<path>?code=instar9840` **with the cellular caveat line pre-appended** to the copy block (standing rules, embedded) · a **Mark as DMed** button that logs `outreach_log(out, text)` — pasting what was actually sent is encouraged, for later reply-rate learning.
**Pacing guard**: today's DM count visible always · soft warning at **25/day** · hard warning at **40/day**. New outbound volume from a personal account is how accounts get actioned; slow is safe and matches the real time budget.

## 8.4 `/metrics`
Per-source qualification rate (the empirical test of the market-size estimate) · funnel conversions per stage · cost per qualified candidate (`spend` ÷ qualified) · DMs/day trend · reply rate. **Wave two gets planned from this screen, not from vibes.** `npm run export` → CSV of signed + funnel summary: the Ashok package.

---

# PART IX — THE OBSERVATORY

Every harvest/enrichment writes an append-only snapshot: follower_count, posts_30d, format_mix, engagement_proxy. **Ratified A3**: a snapshot is written when the adapter or enrichment actually OBSERVED metrics — an all-null row is noise, not data, and would skew every panel average it later joins. Hashtag/commenter actors return follower counts and so snapshot at harvest time; a SERP hit carries no metrics and waits for enrichment. Snapshots are never deduplicated away after the fact: Law 9 makes them permanent, so the discipline is at the write. Accumulated, this is a **longitudinal panel of the exact market** — the cold-start substrate for the benchmarks module's public-side columns ("coaches your size post X/week, grow Y%/month") and the watchlist data model, replacing vendor folklore with observed numbers *before the fleet exists*.

**The hard boundary (canon)**: Antenna data **informs** the product (internal calibration, benchmark cold-start, strategist research); it **never renders in** the customer-facing product. Product surfaces draw from consented Graph API data only — (1) public metrics are shallow (followers/cadence visible; reach, saves, sends, DM starts, revenue are not — and those are the strategist's precision bar), and (2) Instar's roadmap depends on Meta API approval that scraped-data product features would jeopardize. The observatory shortens the cold start; the fleet loop remains the product's data spine.

---

# PART X — OPS: BUDGET, KEYS, BACKUP, SECURITY

- **Budget enforcement**: before any paid call, `lib/budget.ts` checks `SUM(spend) + estimate ≤ CAP_TOTAL ($250)` and per-run caps (`config/limits.ts`: serp $25 · actors $100 · llm $75). Exceed → pipeline halts with a clear message. Every paid run writes `spend`.
- **Keys**: `.env.local`, personal accounts, never committed, never logged.
- **Backup**: `npm run backup` copies `antenna.db` to `~/Backups/antenna/antenna-YYYYMMDD-HHMM.db` (iCloud-synced dir). Run at the end of every operating session — put it in the session-close habit. **This is durable only where `~/Backups` outlives the process** — true on the MacBook this plan was written for, FALSE on an ephemeral build container, where it resolves inside the same filesystem it is meant to protect against and reports cheerful success about a doomed directory. Durability on that substrate is Part X.2, below.

## X.2 Durability and erasure (ratified, A2-calibration)

The failure this exists for, observed rather than imagined: a fresh container migrated a fresh database, printed *"migrated · 14 enforcement triggers installed"*, and `npm run check` reported **CHECK GREEN** over zero candidates and zero ratifications. Nothing in the system could tell *healthy* from *everything is gone*. Law 2 lists "no lost data" as an **engineered** guarantee; silent amnesia is precisely how that claim goes false, and the Ninth Law applies to our own tooling.

- **`npm run state:export`** writes two artifacts on the Part 2.3 principle. `state/census.json` — person-free (row counts + a **monotonic spend floor**), **committed**. `state/snapshot.json` — all seven tables, **handle-keyed**, **gitignored**, handed to the operator. Handle-keyed is not a preference: candidate ids are autoincrement and re-minted in every rebuilt container, so an id-keyed export restores onto the wrong people.
- **The census is a tripwire, not a record.** `npm run check` goes RED, with an exact inventory of what is missing, whenever a table holds fewer rows than the census records **or the spend ledger falls below its floor**. That second clause closes a Law 6 hole: budget enforcement is `SUM(spend) + estimate ≤ cap`, so a rebuilt container with an empty ledger silently re-authorises the entire $250.
- **`npm run state:restore`** rebuilds from a snapshot under four binding rules: **(1)** history is *replayed* through `transitionStatus` with original timestamps, never written directly, so the Part 8.2 graph and all 14 triggers validate the restored funnel exactly as they validated the original; **(2)** the append-only observation write is guarded at the write, because Law 9 makes a double restore permanent rather than correctable; **(3)** the acceptance assertions run **inside the transaction** and a single red rolls the whole restore back — checking after commit would be a report, not a gate; **(4)** **restore may never mint judgment** — a Law 10 assertion requires every `sourced → qualified` hop to be backed by an `approve` ratification, because the importer is the one code path in the system that could manufacture a DM-able candidate with no decision behind it.
- **Write-through (Law 7-safe).** Every `/ratify` decision *and undo* rewrites the snapshot immediately. The ratify hour is the highest-value data this system will ever hold and the only data no amount of money can reproduce, so it gets zero-window durability, not milestone durability. The export never throws into a keystroke: a failed write is reported and surfaced by the census tripwire, never allowed to block the campaign.
- **`lib/assertions.ts`** holds the DB-state invariants as an importable function precisely so restore can run them mid-transaction. `scripts/check.ts` keeps the CLI and everything that answers *"is the code faithful to canon?"* — above all the Part 8.2 legality check, which reads a **hand-transcribed** `CANON_TRANSITIONS`. A legality check importing `lib/status.ts` could only ever agree with it.

**`npm run forget -- <handle>` (Law 5, ratified).** Law 5 promised trivial delete-on-request from A1 and the system could not do it; every durability copy multiplied data we could not erase. Erasure therefore ships in the same phase as the copies. Because observations are append-only by trigger, the path is **snapshot → filter the person out → rebuild** — which satisfies Law 9 and Law 5 at once, is gated by every invariant before it commits, and cannot happen by accident. It erases the candidate row and its harvested content, history, ratifications, outreach, observations, and the profile packet on disk. It does **not** erase `spend`: those rows carry no handle, and deleting them would make the Law 6 ledger understate real money.

## X.3 The remote state store — the primary durability layer (ratified, A2-calibration ratify pass)

X.2 made data loss *loud*. It did not make it *survivable*: the census is committed and shouts, but the snapshot it shouts about is gitignored by Law 5 and dies with the container, so recovery still depended on a human having downloaded a file and kept it. That is a durability layer whose failure mode is *someone forgot to save an attachment* — and this project already has the counter-example on record. The Apify actor was ratified by the operator on 2026-08-29, the marker was flipped in a working tree, the container was reclaimed before the commit, and a later session found a **DRAFT marker and a ledger that disagreed with it**: the database remembered the spend, git did not remember the authorization. Evidence that lives in one place does not survive.

- **`npm run state:push`** uploads `snapshot`, `census`, `tombstones` and the calibration artifacts to an Apify **key-value store** under the operator's existing `APIFY_TOKEN`. It **exports first**, then pushes what the export wrote — a store carrying a snapshot older than the database would look like durability and restore yesterday.
- **The store must be NAMED, and that is asserted.** Apify garbage-collects *unnamed* stores after a retention window; named ones persist until deleted. A durability layer on an unnamed store has a silent expiry date — the exact failure this exists to end — so `assertNamedStore` refuses an empty name rather than letting the API mint a temporary store that looks like it is working.
- **`npm run state:pull` is the documented first command of every fresh container.** It fetches the records, writes them back to their canonical paths, and restores through the **same gated path** as `state:restore` — history replayed through `transitionStatus`, every invariant evaluated inside the transaction. Pulling cannot import a shape the live system could not have produced. An empty store halts loudly instead of restoring nothing.
- **The write-through reaches the store.** Every `/ratify` decision already rewrote the snapshot immediately; it now pushes too. The push is deliberately **not awaited** — it is a network round trip on the operator's keystroke path and Law 7 says the tool never blocks the campaign — and it runs **after** the census regression guard, so a refused export is never shipped to the store anyway.
- **Downloads become optional backup.** Handing the operator a snapshot file is still supported and still useful; it is no longer the mechanism.
- **Law 5, and why the processor argument holds.** The snapshot is person-linked: handles, bios, captions, DM text. Sending it to Apify is consistent with the already-ratified Law 3 / Law 5 posture because **Apify is the processor that collected this data in the first place** — every bio and caption in the snapshot arrived through an Apify actor run. This adds no new processor and no new jurisdiction. What it *does* add is a second copy, and Law 5 answers copies with erasure.
- **`npm run forget` purges the store, and proves it.** Person-linked records are **deleted outright and then re-pushed** from the rebuilt database — delete-then-write rather than overwrite, because a half-failed overwrite leaves the old snapshot whole. The result is then **verified by re-reading the store**, the same discipline the local `ERASURE INCOMPLETE` check already applied. The purge list is *derived* from the store's key set, so a future person-linked record cannot be added without also being made erasable. `check.ts` §18 drives the purge against an in-memory store and asserts that it deletes every person-linked record, deletes nothing person-free, and is idempotent — the erasure is tested, not merely described.
- **Here, and only here, Law 5 outranks Law 7.** Everywhere else a durability failure is reported and swallowed so the campaign is never blocked. A forget whose remote purge failed **halts**: an erasure that quietly left a remote copy behind is a promise broken silently, which is worse than a loud stop.

**Tombstones.** Erasure that only clears the row is undone by the next harvest, which re-collects the same person from the same query. So a forget writes `state/tombstones.json` — a SHA-256 fingerprint of the handle and a date, nothing else — and **every** door that creates a candidate consults it: `addCandidates` and harvest's own `ingest` INSERT are separate code paths and each carries its own check. Stated plainly, because the Ninth Law applies here too: a fingerprint of a low-entropy public handle is **pseudonymous, not anonymous** — anyone holding this file and a list of handles can confirm a match. It is committed on that understanding, the alternative being either re-harvesting people who asked to be left alone or storing their handles in plaintext forever.
- **Security posture**: localhost only, single user, no auth — therefore **never deploy publicly** without adding auth first (a one-line warning in the README).
- **Account safety** (operating rule, not code): if Instagram shows any action warning, halt all outreach 48–72h, resume at half pace. The tool's pacing guard exists so this never triggers.

---

# PART XI — FAILURE PLAYBOOK (when X breaks, do Y)

| Failure | Response |
|---|---|
| Data actor broken/rate-limited | Swap to another maintained actor of the same class; smoke-test ≤$2; seller-exhaust path is unaffected meanwhile |
| SERP quota/provider issue | Fall back Serper ⇄ Google Programmable Search; queries are provider-agnostic strings |
| Link pages render empty (JS shells) | Already graceful: `link_fetch_status=failed`, score from IG data at lower confidence; consider a rendering-actor fallback only if it exceeds ~30% of fetches |
| Score precision feels off | Run `check:golden`; if green, the vibe is wrong; if red, adjust prompt/few-shot and re-run until green. Never tune without the golden set |
| Metro recall too low (expected risk #1) | Confirm metro stays a *boost not a gate*; lean harder on gym-tags + metro hashtags; `banked` inventory is the wave-three asset, not waste |
| IG account warning | Halt protocol (Part X); review pacing and text variance |
| DB corruption/loss | Restore latest backup; `harvest_runs` provenance allows re-pulling anything since. **Re-pulling only covers the re-derivable half** — ratifications, outreach, status history, notes and `loi_tier` are human acts, not fetches, and no provenance recovers them |
| **Workspace/container reclaimed** (ratified A2-calibration) | The build substrate is ephemeral and `~/Backups` dies with it. `state/census.json` makes the loss LOUD (check goes red with an inventory); `npm run state:restore` rebuilds from the operator-held snapshot; ratify write-through means the window is one decision, not one session |
| Cost anomaly | `spend` ledger by category + run_ref pinpoints it; caps already stopped the bleed |

---

# PART XII — GOVERNANCE & HYGIENE (condensed; unchanged in substance)

Built by Conner for Instar's validation campaign. **Personal repo, personal keys, personal card** (recommended; ratify) — cleanly separable from the M&S estate — **and disclosed**: one line in the post-Friday Ashok update ("built an internal outreach engine for the LOI push; here's the plan and timeline"). Nothing hidden, nothing on M&S metal, ownership treatment deferred to the structure paper where it belongs; one-line item for the attorney consult agenda. Data hygiene per Law 5. If Ashok offers to resource it: "it's small, faster on my side" holds the line warmly; log the offer as a structure-dinner data point.

---

# PART XIII — BUILD PHASES & THE FOUR PROMPTS

*Methodology (doc 11) applies unchanged: one phase per prompt · deviation summaries demanded · carried-over fixes ride at the top of the next prompt · COMMIT AND PUSH is the last line. The prompts below are complete drafts; before pasting A2–A4, prepend whatever the prior phase's deviation summary surfaced.*

## Phase A1 — Spine + Track (1 evening)
```
PHASE A1 — ANTENNA: SPINE + TRACK.
Internal prospecting tool for Instar's LOI campaign. Single user, local-first, no
deploy, no auth (localhost only — README warns: never deploy without auth). This
is a cockpit: density and speed over polish. Borrow Instar tokens (navy #1B2A4A,
ink #16181D, hairline #E9EAF0, Inter 400/500/600, tabular numerals on counts);
the full Instar design law does not bind.

VERIFY FIRST: git remote is the private `antenna` repo — NOT ficm. Abort if wrong.

SCAFFOLD: Next.js + TypeScript App Router. SQLite ./antenna.db via Drizzle +
better-sqlite3, migrations via drizzle-kit. tsx for scripts. No UI kit.
.gitignore: antenna.db*, .env*, /backups.

SCHEMA — implement Part III of the blueprint EXACTLY (enums verbatim):
candidates, status_history, ratifications, harvest_runs, outreach_log,
observations (append-only: expose insert only, no update path), spend.
Enforce: handle unique+lowercased; signed requires loi_tier; every status change
writes status_history.

/pipeline: dense table (handle, tier+score, metro, followers, status,
days-in-status, next action, followups), sort status-priority then score desc,
filters (status/tier/metro/source), row drawer (evidence list, hook, notes,
outreach log, status controls honoring the Part 8.2 transition graph, link-outs).
Funnel strip: counts per status + stage conversion %.

/add: paste one/many handles or IG URLs + CSV upload. Insert as sourced,
source=manual. Dedupe on handle — existing rows surfaced, never duplicated.

Seed 5 realistic example rows across several statuses so every UI state renders.

Scripts: npm run check (Part 2.6 assertions), npm run backup (timestamped copy
to ~/Backups/antenna/).

Verify: dev server clean · /pipeline dense with seeds · add dedupes · status
transitions enforce the graph and write history · check green · tsc clean.
COMMIT to main "A1: spine + track" AND PUSH.
Summarize deviations + inventions for ratification.
```

## Phase A2 — Score + Ratify + Golden set (1 evening)
```
PHASE A2 — ANTENNA: SCORE + RATIFY.
FIRST: [carried fixes from A1 deviations].

Implement Part V (enrich, gated on pre_score >= threshold from config/limits.ts;
every enrichment writes an observation) and Part VI verbatim: prompts/prescore_v1.md
and prompts/score_v1.md exactly as written in the blueprint; models
claude-haiku-4-5 / claude-sonnet-4-6, temp 0; JSON-only with fence-strip, one
retry, then score_failed flag; store score_prompt_version. Few-shot builder
(prompts/fewshot.ts) reads ratifications: up to 10 balanced examples into
{FEW_SHOT_BLOCK}. All LLM spend logged to spend; budget checks per Part X.

/ratify: Part VII exactly — queue card left, evidence panel right (every rubric
line with quoted evidence), keyboard y/n/b/f/j/k/u, reason picker on reject,
every keystroke writes ratifications, decisions move status per the graph.

CALIBRATION RUN (in this phase): I will hand-feed ~20 real handles via /add.
Enrich + score them, present results in /ratify. After my pass, build
golden/set.json from 30 labeled profiles (pad from the batch as needed) and
npm run check:golden asserting >=90% A-vs-not-A tier agreement. NO paid harvest
spend this phase beyond enrichment of the seed batch.

Verify: seed batch scored with evidence quoting real source text · ratify
keyboard flow at speed · fewshot block regenerates after decisions ·
check + check:golden green · tsc clean.
COMMIT "A2: score + ratify + golden" AND PUSH. Deviation summary.
```

## Phase A3 — Harvest adapters (weekend block)
```
PHASE A3 — ANTENNA: HARVEST.
FIRST: [carried fixes from A2].

Adapter contract per Part IV. Build in this order:
1) harvest/serper.ts — seller-exhaust: the Part 4a query library over
   config/metros.ts (create with the 4.5 starter lists); pagination <=5 pages;
   URL-dedupe; lib/fetchLink.ts (1 req/s, 10s timeout, <500 chars => failed,
   never block); handle/offer/price extraction; harvest_runs + spend rows.
2) harvest/hashtags.ts — actor-class integration: select a currently maintained
   no-login hashtag/profile actor; SMOKE-TEST with a <=$2 run and show me results
   before any scale run; map outputs to CandidateSeed; starter hashtag list from
   Part 4b into config.
3) harvest/commenters.ts — STRETCH ONLY if 1–2 land cleanly: commenters/tagged
   from a seed-account list in config (leave list empty; I fill it).
Budget: hard stop via lib/budget.ts (serp $25 / actors $100 / total $250).
Pipeline UI: /settings page with run buttons per adapter, params, live run log,
per-run cost estimate shown BEFORE confirm.

Verify: one real serper run inserts deduped, provenance-stamped candidates ·
actor smoke-test results shown · budget stop demonstrably triggers on a
simulated overage · check green · tsc clean.
COMMIT "A3: harvest" AND PUSH. Deviation summary + any invented
queries/hashtags flagged for ratification.
```

## Phase A4 — The hour of truth (1 evening)
```
PHASE A4 — ANTENNA: METRICS + THE MEASURED RUN.
FIRST: [carried fixes from A3].

/metrics per Part 8.4: per-source qualification rate, funnel conversions, cost
per qualified, DMs/day, reply rate. npm run export => CSV (signed + funnel
summary).

THE RUN: harvest -> pre-score -> enrich -> score ~100 candidates PER METRO
(respecting caps). I ratify. Then compute and present: qualification rate per
source, cost per qualified, A-tier count, metro recall observations, and a
one-paragraph honest read: which sources earn scale, which die.

DM composer polish per Part 8.3: share-link generator (?code=instar9840 +
cellular line pre-appended), pacing counters (soft 25 / hard 40), Mark-as-DMed
logging outreach_log, follow-up due queue on /pipeline (one follow-up max,
5-7 days, then no_response — enforced).

Verify: metrics live against real data · export opens clean · pacing +
follow-up rules enforced · check + check:golden green · tsc clean.
COMMIT "A4: metrics + measured run" AND PUSH. Deviation summary + the
go/no-go read on scaling each source.
```

**Definition of done, v1**: all four phases committed · golden green · the A4 measured run produced per-source qualification rates · ≥1 real candidate walked `sourced → qualified → dmed` end-to-end · backup habit live.

---

# PART XIV — OPERATING RHYTHM (post-build)

**Daily (~30–45 min)**: ratify the new batch (queue speed makes this ~15 min) → send 15–25 *adapted* DMs from A-tier, logging each → process replies + today's follow-up queue → `npm run backup` on close.
**Weekly**: /metrics review → tune (few-shot from the week's ratifications; `check:golden` after any change) → top-up harvest on the sources that earned it → plan next wave from numbers.
**Campaign integration**: build A1–A2 the evenings after Friday · A3 the weekend · A4 before wave one · **wave one launches only after Christopher confirms** (his name is the opener's credibility engine — sequencing canon, doc 08) · warm intros enter via /add the day they arrive · the export lands in the Ashok package when the 10th strong LOI signs.

---

# PART XV — OPEN ITEMS TO RATIFY

1. Name — "Antenna" (working) or otherwise.
2. Repo host + spend — personal GitHub + personal card (recommended).
3. API accounts — personal keys (recommended, same logic).
4. Thresholds — `PRESCORE_THRESHOLD` 40 · tier cuts A75/B55/C40 · pacing 25/40 · follow-up 1× at 5–7 days. Defaults stand unless red-penned.
5. Metro config — NYC + SoFla confirmed as wave one; Philly as free add-on later, wave three national via `banked`.
6. Goal tiers — T1/T2/T3 definitions and the 20–25 / ≥8–10 internal goal (Ashok's gate stays 10).
7. Disclosure line to Ashok — in the post-Friday update, in Conner's dictated voice.
8. The starter query + hashtag libraries — red-pen before A3 runs them.

---

# PART XVI — GLOSSARY & MAINTENANCE

**Antenna** — this tool. · **Seller exhaust** — the public footprint of active selling (Stan/Linktree/CTAs) used as the primary discovery channel. · **Pre-score / full score** — the two-stage LLM pipeline. · **Ratify queue** — the keyboard taste-gate that turns scores into DM-able candidates and training data. · **Golden set** — the frozen 30-profile regression test for scoring. · **Banked** — right coach, wrong/unknown metro; wave-three inventory. · **The hour of truth** — A4's measured 100-per-metro run that converts market-size estimates into per-source data. · **The Observatory** — the append-only public-market panel; informs the product, never renders in it. · **T1/T2/T3** — LOI strength tiers (signature / beta commitment / deposit).

**Maintenance**: update Part 0's status board and the phase log after every build session (this doc is Antenna's BUILD_STATE) · ratified inventions from deviation summaries get written into Part III/IV/VI as canon · add row 15 to doc 13's inventory · after A4, write the measured qualification rates into Part 0 so the next chat starts from data, not estimates.
