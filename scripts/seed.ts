/**
 * Seed 5 realistic candidates so every UI state renders: all four tier chips,
 * both metros plus unknown, live / hot / won / rejected statuses, real
 * status_history chains (so days-in-status and the funnel conversions are
 * meaningful), outreach entries, ratifications and observation snapshots.
 *
 * Fixtures are traceable: score_prompt_version = 'seed_fixture'. Real scores
 * arrive in A2 and carry the real prompt version.
 *
 *   npm run seed            # add fixtures if absent
 *   npm run seed -- --reset # drop candidates first (observations survive: Law 9)
 */
import { getSqlite } from '@/db/connection'
import { recordObservation } from '@/db/observations'
import { addCandidates, logOutreach, recordRatification, transitionStatus } from '@/db/repo'
import { toJson } from '@/db/json'
import type { Status } from '@/db/enums'
import { runMigrations } from './migrate'

const DAY = 86_400_000
const ago = (days: number, hour = 14) => {
  const d = new Date(Date.now() - days * DAY)
  d.setUTCHours(hour, 17, 0, 0)
  return d.toISOString()
}

type Fixture = {
  handle: string
  name: string
  followerCount: number
  bio: string
  linkUrl: string
  metro: 'nyc' | 'sofla' | 'other' | 'unknown'
  metroConfidence: number
  preScore: number
  score: number
  tier: 'A' | 'B' | 'C' | 'X'
  evidence: string[]
  stackSignals: string[]
  extracted: Record<string, unknown>
  hookDraft: string
  notes?: string
  firstSeenDaysAgo: number
  /** Walked in order; each step backdated. */
  walk: { to: Status; daysAgo: number; note?: string; loiTier?: 't1' | 't2' | 't3' }[]
  ratify?: { decision: 'approve' | 'reject' | 'bank' | 'flag'; reason: string | null; daysAgo: number }
  outreach?: { direction: 'out' | 'in'; text: string; daysAgo: number }[]
  followupCount?: number
  nextActionDate?: string
  observations?: { daysAgo: number; followerCount: number; posts30d: number; engagementProxy: number }[]
}

const FIXTURES: Fixture[] = [
  {
    handle: 'nyc.lift.coach',
    name: 'Priya Raman',
    followerCount: 4280,
    bio: 'Online strength coach · NYC 🗽 1:1 remote programming · 2 spots open — link below',
    linkUrl: 'https://stan.store/nycliftcoach',
    metro: 'nyc', metroConfidence: 0.95,
    preScore: 78, score: 82, tier: 'A',
    evidence: [
      'Bio reads "Online strength coach · NYC" — explicit metro and online-only positioning.',
      'Stan Store page lists "1:1 Remote Coaching — $349/mo" and "12-Week Build — $899".',
      '"2 spots open" in the bio and in 3 of the last 6 captions: visible scarcity selling.',
      'Last 6 captions all carry "DM me SPOTS" — the business runs through DMs.',
      'Posted 4 days ago; 6 posts in the last 30 days.',
    ],
    stackSignals: ['stan_store', 'calendly'],
    extracted: {
      name: 'Priya Raman',
      offers: [{ type: '1:1 remote coaching', price: '$349/mo' }, { type: '12-week build', price: '$899' }],
      lead_magnet: 'Free 5-day core primer',
    },
    hookDraft: 'Her Stan page runs a $349/mo 1:1 tier alongside a $899 12-week block — two price points, one DM inbox doing all the intake.',
    notes: 'Warm-ish: follows two of Christopher’s clients. Good first-wave candidate.',
    firstSeenDaysAgo: 9,
    walk: [{ to: 'qualified', daysAgo: 6, note: 'ratified approve' }],
    ratify: { decision: 'approve', reason: 'textbook profile — selling, DM-run, NYC, right size', daysAgo: 6 },
    observations: [
      { daysAgo: 9, followerCount: 4155, posts30d: 5, engagementProxy: 0.041 },
      { daysAgo: 2, followerCount: 4280, posts30d: 6, engagementProxy: 0.038 },
    ],
  },
  {
    handle: 'marcus.movesbetter',
    name: 'Marcus Ellery',
    followerCount: 6840,
    bio: 'Brooklyn → online. Hybrid athlete coaching. Comment READY for the free assessment.',
    linkUrl: 'https://linktr.ee/movesbetter',
    metro: 'nyc', metroConfidence: 0.88,
    preScore: 72, score: 78, tier: 'A',
    evidence: [
      'Bio "Brooklyn → online" — metro explicit, and the arrow signals the studio-to-online move.',
      '"Comment READY for the free assessment" is a comment-word CTA on 4 of the last 6 posts.',
      'Linktree ends in a DM-based application, not a checkout — intake is manual.',
      'Posts 5x in the last 30 days, most recent 2 days ago.',
    ],
    stackSignals: ['linktree', 'google_forms'],
    extracted: {
      name: 'Marcus Ellery',
      offers: [{ type: 'Hybrid athlete coaching', price: null }],
      lead_magnet: 'Free movement assessment',
    },
    hookDraft: 'Runs a "comment READY" assessment funnel on 4 of his last 6 posts — every lead lands in his DMs by hand.',
    notes: 'Sent the Christopher-referenced opener. One follow-up already used — no third touch.',
    firstSeenDaysAgo: 21,
    walk: [
      { to: 'qualified', daysAgo: 18, note: 'ratified approve' },
      { to: 'dmed', daysAgo: 14, note: 'opener sent, Christopher referenced' },
    ],
    ratify: { decision: 'approve', reason: 'comment-CTA funnel = DM-run, exactly our shape', daysAgo: 18 },
    outreach: [
      { direction: 'out', text: 'Marcus — Christopher mentioned you when we were talking about coaches who actually run intake themselves. Your "comment READY" funnel is the cleanest version of that I have seen this month. Building something for exactly that problem — worth 15 minutes?', daysAgo: 14 },
      { direction: 'out', text: 'No worries if the timing is off — leaving this here in case it is useful later.', daysAgo: 8 },
    ],
    followupCount: 1,
    nextActionDate: new Date(Date.now() + DAY).toISOString().slice(0, 10),
    observations: [{ daysAgo: 21, followerCount: 6610, posts30d: 5, engagementProxy: 0.052 }],
  },
  {
    handle: 'coach.dani.miami',
    name: 'Daniela Ortiz',
    followerCount: 2130,
    bio: 'Nutrition + lifting for busy women · Miami · apply below ↓',
    linkUrl: 'https://stan.store/danicoaching',
    metro: 'sofla', metroConfidence: 0.92,
    preScore: 66, score: 64, tier: 'B',
    evidence: [
      'Bio names Miami directly.',
      'Stan Store lists "Group Coaching — $149/mo"; no 1:1 tier visible.',
      '"apply below" routes to a form, then a DM — partial DM-run.',
      'Only 3 posts in the last 30 days; last one 11 days ago.',
    ],
    stackSignals: ['stan_store'],
    extracted: { name: 'Daniela Ortiz', offers: [{ type: 'Group coaching', price: '$149/mo' }], lead_magnet: null },
    hookDraft: 'Her Stan page sells one $149/mo group tier only — no 1:1 rung above it, which is the ceiling our pitch names.',
    notes: 'Replied same day. Warm, asked what the platform actually does.',
    firstSeenDaysAgo: 16,
    walk: [
      { to: 'qualified', daysAgo: 13, note: 'ratified approve' },
      { to: 'dmed', daysAgo: 11 },
      { to: 'replied', daysAgo: 10, note: 'asked what it does — good sign' },
    ],
    ratify: { decision: 'approve', reason: 'B tier: selling and SoFla, but cadence is thin', daysAgo: 13 },
    outreach: [
      { direction: 'out', text: 'Dani — noticed your group tier is the only rung on the Stan page. Curious whether the 1:1 asks pile up in your DMs instead?', daysAgo: 11 },
      { direction: 'in', text: 'ha, constantly. what are you building?', daysAgo: 10 },
    ],
    nextActionDate: new Date(Date.now() - DAY).toISOString().slice(0, 10),
    observations: [{ daysAgo: 16, followerCount: 2090, posts30d: 3, engagementProxy: 0.067 }],
  },
  {
    handle: 'strongwith.tara',
    name: 'Tara Whitfield',
    followerCount: 9410,
    bio: 'Fort Lauderdale · online coach · 8 yrs · DM "STRONG" to apply · 40+ transformations',
    linkUrl: 'https://stan.store/strongwithtara',
    metro: 'sofla', metroConfidence: 0.97,
    preScore: 85, score: 88, tier: 'A',
    evidence: [
      'Bio: "Fort Lauderdale · online coach" — metro and online purity both explicit.',
      '"DM “STRONG” to apply" is the entire intake path: fully DM-run.',
      'Stan Store shows "1:1 Coaching — $1,200 / 6 months, paid upfront".',
      '8 posts in 30 days, most recent yesterday; 40+ documented transformations.',
      'Engagement proxy 5.9% at 9.4K — well above the size band median.',
    ],
    stackSignals: ['stan_store', 'venmo_mention'],
    extracted: {
      name: 'Tara Whitfield',
      offers: [{ type: '1:1 coaching', price: '$1,200 / 6mo upfront' }],
      lead_magnet: null,
    },
    hookDraft: 'Her Stan page leads with a $1,200 six-month-upfront option — same commitment model as ours, already proven on her own list.',
    notes: 'Signed T2: signature plus a stated beta commitment for the first cohort.',
    firstSeenDaysAgo: 34,
    walk: [
      { to: 'qualified', daysAgo: 31, note: 'ratified approve — best profile in the batch' },
      { to: 'dmed', daysAgo: 29 },
      { to: 'replied', daysAgo: 28 },
      { to: 'call_booked', daysAgo: 25, note: '20 min, Thursday' },
      { to: 'demo_given', daysAgo: 21, note: 'walked the strategist mockup' },
      { to: 'loi_sent', daysAgo: 12 },
      { to: 'signed', daysAgo: 5, note: 'T2 — signature + beta commitment', loiTier: 't2' },
    ],
    ratify: { decision: 'approve', reason: 'the archetype: DM-run, upfront pricing, SoFla, 9.4K', daysAgo: 31 },
    outreach: [
      { direction: 'out', text: 'Tara — the $1,200 six-month upfront on your Stan page is the same shape as what we are building toward. Would you look at a mockup and tell me where it is wrong?', daysAgo: 29 },
      { direction: 'in', text: 'sure, send it over. always curious what people think coaches need lol', daysAgo: 28 },
      { direction: 'in', text: 'signed and sent back. happy to be in the first cohort.', daysAgo: 5 },
    ],
    observations: [
      { daysAgo: 34, followerCount: 8980, posts30d: 7, engagementProxy: 0.061 },
      { daysAgo: 17, followerCount: 9210, posts30d: 8, engagementProxy: 0.059 },
      { daysAgo: 3, followerCount: 9410, posts30d: 8, engagementProxy: 0.059 },
    ],
  },
  {
    handle: 'bulkbros.gym',
    name: 'BulkBros Gym',
    followerCount: 31200,
    bio: 'Two locations. Squat racks, chalk, and no excuses. Memberships from $79/mo.',
    linkUrl: 'https://bulkbrosgym.com',
    metro: 'other', metroConfidence: 0.4,
    preScore: 18, score: 22, tier: 'X',
    evidence: [
      'GATE FAILED — is_individual_coach: "Two locations" and a brand voice, not a person.',
      'GATE FAILED — sells_online_coaching: the only offer is a $79/mo gym membership.',
      'Follower count 31,200 is well outside the 1K-10K band.',
      'No DM CTA anywhere in the last 6 captions; link goes to a membership checkout.',
    ],
    stackSignals: ['shopify'],
    extracted: { name: 'BulkBros Gym', offers: [{ type: 'Gym membership', price: '$79/mo' }], lead_magnet: null },
    hookDraft: 'Gate-failed: a two-location gym brand, not an individual coach. Kept for the record, not for outreach.',
    firstSeenDaysAgo: 12,
    walk: [{ to: 'rejected', daysAgo: 10, note: 'gym, not a coach' }],
    ratify: { decision: 'reject', reason: 'gym-floor', daysAgo: 10 },
    observations: [{ daysAgo: 12, followerCount: 31200, posts30d: 12, engagementProxy: 0.008 }],
  },

  // ------------------------------------------------------------ A2: the ratify queue
  // Scored, still `sourced` — these render /ratify and feed its E2E. Evidence
  // uses the structured GATE/DIM/PENALTY prefixes the evidence panel groups by.
  {
    handle: 'lift.with.rosa',
    name: 'Rosa Delgado',
    followerCount: 5200,
    bio: 'Online powerlifting coach · Bronx, NYC · 1:1 programming · DM "BAR" to apply',
    linkUrl: 'https://stan.store/liftwithrosa',
    metro: 'nyc', metroConfidence: 0.93,
    preScore: 81, score: 86, tier: 'A',
    evidence: [
      'GATE sells_online_coaching: PASS — Stan page sells "1:1 Programming — $289/mo" and a "$799 12-week meet prep".',
      'GATE is_individual_coach: PASS — first-person bio, one face across the grid, "I coach" language throughout.',
      'GATE alive_30d: PASS — 8 posts in 30 days, most recent 2 days ago.',
      'DIM dm_run 23/25 — "DM “BAR” to apply" is the entire intake; no checkout link anywhere.',
      'DIM size_band 20/20 — 5,200 followers sits mid-band.',
      'DIM metro 14/15 — "Bronx, NYC" explicit in bio.',
      'DIM online_purity 14/15 — "online powerlifting coach", no gym-floor sessions offered.',
      'DIM activity 9/10 — 8 posts / 30 days.',
      'DIM engagement_proxy 4/5 — proxy 5.1% at 5.2K.',
      'PENALTY incumbent_tooling -2 — Stan Store already in place (the duct-tape stack, not a platform).',
    ],
    stackSignals: ['stan_store'],
    extracted: { name: 'Rosa Delgado', offers: [{ type: '1:1 programming', price: '$289/mo' }, { type: '12-week meet prep', price: '$799' }], lead_magnet: null },
    hookDraft: 'Her $799 meet-prep block sells out via DM "BAR" — intake is one inbox, zero tooling.',
    firstSeenDaysAgo: 3,
    walk: [],
  },
  {
    handle: 'coach.tomas.mia',
    name: 'Tomás Rivera',
    followerCount: 7400,
    bio: 'Miami online coach ☀️ body recomp for men 30+ · comment "PLAN" for the starter guide',
    linkUrl: 'https://linktr.ee/coachtomas',
    metro: 'sofla', metroConfidence: 0.9,
    preScore: 77, score: 80, tier: 'A',
    evidence: [
      'GATE sells_online_coaching: PASS — Linktree lists "Online Coaching — $249/mo" with an application form.',
      'GATE is_individual_coach: PASS — personal brand, single coach, client DMs screenshotted in highlights.',
      'GATE alive_30d: PASS — 6 posts in 30 days.',
      'DIM dm_run 20/25 — "comment “PLAN”" funnel on 4 of last 6 posts; application ends in a DM conversation.',
      'DIM size_band 20/20 — 7,400 followers, mid-band.',
      'DIM metro 13/15 — "Miami" in bio; Wynwood gym tags on 2 recent posts.',
      'DIM online_purity 12/15 — online-first; one in-person bootcamp per quarter.',
      'DIM activity 8/10 — 6 posts / 30 days.',
      'DIM engagement_proxy 4/5 — proxy 4.6%.',
      'PENALTY incumbent_tooling -3 — Calendly + Google Forms stack visible in the funnel.',
    ],
    stackSignals: ['linktree', 'calendly', 'google_forms'],
    extracted: { name: 'Tomás Rivera', offers: [{ type: 'Online coaching', price: '$249/mo' }], lead_magnet: 'Recomp starter guide' },
    hookDraft: 'Runs a "comment PLAN" guide funnel on 4 of his last 6 posts — classic comment-word CTA.',
    firstSeenDaysAgo: 3,
    walk: [],
  },
  {
    handle: 'strength.sam.nyc',
    name: 'Sam Okafor',
    followerCount: 2900,
    bio: 'Strength coach · Manhattan · online + in-person · link for programs',
    linkUrl: 'https://beacons.ai/strengthsam',
    metro: 'nyc', metroConfidence: 0.85,
    preScore: 62, score: 66, tier: 'B',
    evidence: [
      'GATE sells_online_coaching: PASS — Beacons page sells "Remote Coaching — $199/mo" beside in-person packages.',
      'GATE is_individual_coach: PASS — individual trainer, personal grid.',
      'GATE alive_30d: PASS — 4 posts in 30 days.',
      'DIM dm_run 14/25 — "link for programs" leads to checkout; DMs used for questions, not intake.',
      'DIM size_band 20/20 — 2,900 followers, in-band.',
      'DIM metro 13/15 — "Manhattan" explicit.',
      'DIM online_purity 7/15 — split offer: "online + in-person" in the bio itself.',
      'DIM activity 6/10 — 4 posts / 30 days.',
      'DIM engagement_proxy 3/5 — proxy 3.2%.',
      'PENALTY incumbent_tooling -7 — Beacons storefront with built-in checkout covers most of the pitch surface.',
    ],
    stackSignals: ['beacons', 'stripe_checkout'],
    extracted: { name: 'Sam Okafor', offers: [{ type: 'Remote coaching', price: '$199/mo' }, { type: 'In-person training', price: '$90/session' }], lead_magnet: null },
    hookDraft: 'His Beacons page sells remote and in-person side by side — the online half looks underworked.',
    firstSeenDaysAgo: 2,
    walk: [],
  },
  {
    handle: 'macro.mentor.kate',
    name: 'Kate Lindqvist',
    followerCount: 6100,
    bio: 'Macro coaching for runners · fully online · apply via DM 🏃‍♀️',
    linkUrl: 'https://stan.store/macromentor',
    metro: 'unknown', metroConfidence: 0.2,
    preScore: 68, score: 58, tier: 'B',
    evidence: [
      'GATE sells_online_coaching: PASS — Stan page: "Macro Coaching — $179/mo", application-gated.',
      'GATE is_individual_coach: PASS — solo coach, personal voice.',
      'GATE alive_30d: PASS — 5 posts in 30 days.',
      'DIM dm_run 22/25 — "apply via DM" is the sole intake path.',
      'DIM size_band 20/20 — 6,100 followers.',
      'DIM metro 0/15 — no location signal anywhere in bio, captions or tags (NOT a rejection — bank material).',
      'DIM online_purity 15/15 — "fully online" explicit.',
      'DIM activity 7/10 — 5 posts / 30 days.',
      'DIM engagement_proxy 4/5 — proxy 4.4%.',
      'PENALTY incumbent_tooling -2 — Stan Store.',
    ],
    stackSignals: ['stan_store', 'tiktok_presence'],
    extracted: { name: 'Kate Lindqvist', offers: [{ type: 'Macro coaching', price: '$179/mo' }], lead_magnet: null, tiktok_url: 'https://tiktok.com/@macromentorkate' },
    hookDraft: 'Right coach, no metro signal at all — the textbook bank: strong DM funnel, unknown geography.',
    firstSeenDaysAgo: 2,
    walk: [],
  },
  {
    handle: 'fit.journey.jess',
    name: 'Jess Palmer',
    followerCount: 1400,
    bio: 'Fort Lauderdale · sharing my coaching journey · 1:1 spots soon 👀',
    linkUrl: 'https://linktr.ee/fitjourneyjess',
    metro: 'sofla', metroConfidence: 0.88,
    preScore: 51, score: 47, tier: 'C',
    evidence: [
      'GATE sells_online_coaching: PASS — barely: "1:1 spots soon" plus a $49 PDF program on the Linktree.',
      'GATE is_individual_coach: PASS — individual, early-stage.',
      'GATE alive_30d: PASS — 3 posts in 30 days.',
      'DIM dm_run 8/25 — no CTA pattern yet; DMs mentioned once in a story highlight.',
      'DIM size_band 10/20 — 1,400 followers, low end of band.',
      'DIM metro 13/15 — "Fort Lauderdale" explicit.',
      'DIM online_purity 10/15 — intent is online, but nothing sold as coaching yet.',
      'DIM activity 4/10 — 3 posts / 30 days.',
      'DIM engagement_proxy 2/5 — proxy 2.1%.',
      'PENALTY incumbent_tooling 0 — nothing in place.',
    ],
    stackSignals: ['linktree'],
    extracted: { name: 'Jess Palmer', offers: [{ type: 'PDF program', price: '$49' }], lead_magnet: null },
    hookDraft: '"1:1 spots soon" — pre-revenue coach; revisit if the funnel starves.',
    firstSeenDaysAgo: 1,
    walk: [],
  },
  {
    handle: 'shredz.supplements',
    name: 'SHREDZ Supps',
    followerCount: 18700,
    bio: 'Fuel your grind 💊 code SHREDZ15 · free shipping over $75',
    linkUrl: 'https://shredzsupps.com',
    metro: 'other', metroConfidence: 0.3,
    preScore: 44, score: 21, tier: 'X',
    evidence: [
      'GATE sells_online_coaching: FAIL — the only products are supplements; no coaching offer anywhere.',
      'GATE is_individual_coach: FAIL — brand account, athlete reposts, no individual voice.',
      'GATE alive_30d: PASS — posts daily.',
      'DIM dm_run 2/25 — DMs route to customer support.',
      'DIM size_band 10/20 — 18,700 sits in the half-credit band.',
      'DIM metro 0/15 — no metro signal.',
      'DIM online_purity 3/15 — e-commerce, not coaching.',
      'DIM activity 10/10 — daily posting.',
      'DIM engagement_proxy 1/5 — proxy 0.7%.',
      'PENALTY incumbent_tooling -10 — full Shopify storefront.',
    ],
    stackSignals: ['shopify', 'discount_codes'],
    extracted: { name: 'SHREDZ Supps', offers: [{ type: 'Supplements', price: null }], lead_magnet: null },
    hookDraft: 'Gate-failed twice over: a supplement brand, not a coach. One keystroke and gone.',
    firstSeenDaysAgo: 1,
    walk: [],
  },
]

function main() {
  const reset = process.argv.includes('--reset')
  runMigrations()
  const sqlite = getSqlite()

  if (reset) {
    const n = sqlite.prepare('SELECT count(*) AS c FROM candidates').get() as { c: number }
    sqlite.exec('DELETE FROM candidates')
    console.log(`reset: dropped ${n.c} candidates (history, outreach and ratifications cascaded).`)
    console.log('       observations were NOT dropped — the Observatory is append-only (Law 9).')
  }

  let added = 0
  let skipped = 0

  for (const f of FIXTURES) {
    const [outcome] = addCandidates([f.handle], 'manual', 'seed fixture')
    if (outcome.kind !== 'added') { skipped++; continue }
    added++
    const id = outcome.id

    sqlite.prepare(
      `UPDATE candidates SET name=?, follower_count=?, bio=?, link_url=?, link_domain=?,
         link_fetch_status='ok', metro=?, metro_confidence=?, first_seen=?, last_enriched=?,
         pre_score=?, score=?, tier=?, score_prompt_version='seed_fixture', evidence=?,
         hook_draft=?, stack_signals=?, extracted=?, notes=?, followup_count=?,
         next_action_date=?, created_at=?, updated_at=?
       WHERE id=?`,
    ).run(
      f.name, f.followerCount, f.bio, f.linkUrl, new URL(f.linkUrl).hostname.replace(/^www\./, ''),
      f.metro, f.metroConfidence, ago(f.firstSeenDaysAgo), ago(Math.max(0, f.firstSeenDaysAgo - 2)),
      f.preScore, f.score, f.tier, toJson(f.evidence), f.hookDraft, toJson(f.stackSignals),
      toJson(f.extracted), f.notes ?? null, f.followupCount ?? 0, f.nextActionDate ?? null,
      ago(f.firstSeenDaysAgo), ago(f.firstSeenDaysAgo), id,
    )
    // Genesis history row was written at insert-time "now"; align it with first_seen.
    sqlite.prepare(
      'UPDATE status_history SET at=? WHERE id=(SELECT min(id) FROM status_history WHERE candidate_id=?)',
    ).run(ago(f.firstSeenDaysAgo), id)

    if (f.ratify) recordRatification(id, f.ratify.decision, f.ratify.reason, ago(f.ratify.daysAgo))
    for (const step of f.walk) {
      transitionStatus(id, step.to, { note: step.note ?? null, at: ago(step.daysAgo), loiTier: step.loiTier })
    }
    for (const o of f.outreach ?? []) logOutreach(id, o.direction, o.text, ago(o.daysAgo))
    // Observations are append-only (Law 9) and survive --reset, so a re-seed
    // must not re-insert the same fixture snapshot: identical readings at one
    // instant are false data that NOTHING can later remove.
    const seenObs = sqlite.prepare(
      'SELECT 1 FROM observations WHERE handle=? AND observed_at=? AND source=?',
    )
    for (const ob of f.observations ?? []) {
      if (seenObs.get(f.handle, ago(ob.daysAgo), 'seed fixture')) continue
      recordObservation({
        handle: f.handle,
        observedAt: ago(ob.daysAgo),
        followerCount: ob.followerCount,
        posts30d: ob.posts30d,
        engagementProxy: ob.engagementProxy,
        formatMix: { reel: 0.6, carousel: 0.25, image: 0.15 },
        source: 'seed fixture',
      })
    }
  }

  const counts = sqlite.prepare('SELECT status, count(*) c FROM candidates GROUP BY status ORDER BY status').all() as { status: string; c: number }[]
  console.log(`seeded: ${added} added, ${skipped} already present`)
  console.log('statuses: ' + counts.map((r) => `${r.status}=${r.c}`).join(' · '))
  if (skipped && !reset) console.log('(re-run with -- --reset to rebuild the fixtures)')
}

main()
