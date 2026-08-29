import { SettingsClient } from '@/components/SettingsClient'
import { DEFAULT_PROFILE_ACTOR, actorSelectionIsDraft } from '@/config/actors'
import { CAPS } from '@/config/limits'
import { QUERY_LIBRARY_STATUS } from '@/config/queries'
import { HASHTAG_LIBRARY_STATUS } from '@/config/hashtags'
import { SEED_LIST_STATUS, SEED_ACCOUNTS } from '@/config/seeds'
import { recentHarvestRuns, spendSummary } from '@/db/metrics'
import { ANTHROPIC_KEY_NAMES, anthropicKeyPresent, loadEnvLocal } from '@/lib/env'

export const dynamic = 'force-dynamic'

export default function SettingsPage() {
  loadEnvLocal()
  const spend = spendSummary()
  const runs = recentHarvestRuns()

  // Presence only — a value is never read into the page (Part X: never logged).
  const keys = {
    // Alias-aware: the platform filters the reserved name, so the key may
    // arrive as ANTENNA_ANTHROPIC_KEY. Either name lights this lamp.
    [ANTHROPIC_KEY_NAMES[0]]: anthropicKeyPresent(),
    SERPER_API_KEY: !!process.env.SERPER_API_KEY?.trim(),
    APIFY_TOKEN: !!process.env.APIFY_TOKEN?.trim(),
  }

  const drafts = {
    queries: QUERY_LIBRARY_STATUS.startsWith('DRAFT'),
    hashtags: HASHTAG_LIBRARY_STATUS.startsWith('DRAFT'),
    seeds: SEED_LIST_STATUS.startsWith('DRAFT'),
    seedCounts: { nyc: SEED_ACCOUNTS.nyc.length, sofla: SEED_ACCOUNTS.sofla.length },
    // Part 4b: an actor is ratified by passing a <= $2 smoke test in front of
    // the operator, so its gate belongs beside the library gates.
    actor: actorSelectionIsDraft(),
    actorId: DEFAULT_PROFILE_ACTOR.id,
  }

  return (
    <>
      <h1 className="h1">Settings &amp; harvest</h1>
      <p className="sub">
        Run adapters with the cost estimate shown before you confirm. Fixture runs are free and
        offline; real runs stay locked behind keys AND ratified libraries (Part XV.8).
      </p>
      <SettingsClient
        keys={keys}
        drafts={drafts}
        spend={{ byCategory: spend.byCategory, total: spend.total, caps: CAPS }}
        runs={runs}
      />
    </>
  )
}
