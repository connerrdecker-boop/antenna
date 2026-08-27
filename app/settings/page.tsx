import { SettingsClient } from '@/components/SettingsClient'
import { CAPS } from '@/config/limits'
import { QUERY_LIBRARY_STATUS } from '@/config/queries'
import { HASHTAG_LIBRARY_STATUS } from '@/config/hashtags'
import { SEED_LIST_STATUS, SEED_ACCOUNTS } from '@/config/seeds'
import { recentHarvestRuns, spendSummary } from '@/db/metrics'
import { loadEnvLocal } from '@/lib/env'

export const dynamic = 'force-dynamic'

export default function SettingsPage() {
  loadEnvLocal()
  const spend = spendSummary()
  const runs = recentHarvestRuns()

  // Presence only — a value is never read into the page (Part X: never logged).
  const keys = {
    ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY?.trim(),
    SERPER_API_KEY: !!process.env.SERPER_API_KEY?.trim(),
    APIFY_TOKEN: !!process.env.APIFY_TOKEN?.trim(),
  }

  const drafts = {
    queries: QUERY_LIBRARY_STATUS.startsWith('DRAFT'),
    hashtags: HASHTAG_LIBRARY_STATUS.startsWith('DRAFT'),
    seeds: SEED_LIST_STATUS.startsWith('DRAFT'),
    seedCounts: { nyc: SEED_ACCOUNTS.nyc.length, sofla: SEED_ACCOUNTS.sofla.length },
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
