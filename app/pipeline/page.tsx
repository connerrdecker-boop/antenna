import { FunnelStrip } from '@/components/FunnelStrip'
import { PipelineClient } from '@/components/PipelineClient'
import { METROS, STATUSES, TIERS, type Metro, type Status, type Tier } from '@/db/enums'
import { funnelStats, listCandidates, listSources, type PipelineFilters } from '@/db/repo'

// SQLite is read on every request; nothing here is cacheable.
export const dynamic = 'force-dynamic'

type SP = Record<string, string | string[] | undefined>

function pick<T extends string>(sp: SP, key: string, allowed: readonly T[]): T | 'all' {
  const v = sp[key]
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : 'all'
}

export default async function PipelinePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams
  const sources = listSources()
  const filters: PipelineFilters = {
    status: pick<Status>(sp, 'status', STATUSES),
    tier: pick<Tier>(sp, 'tier', TIERS),
    metro: pick<Metro>(sp, 'metro', METROS),
    source: pick(sp, 'source', sources),
  }

  const rows = listCandidates(filters)
  const stats = funnelStats()

  return (
    <>
      <h1 className="h1">Pipeline</h1>
      <p className="sub">
        Every conversation, first message to signed LOI. Sorted by what needs your hands soonest,
        then score. Antenna preps — you send.
      </p>
      <FunnelStrip stats={stats} />
      <PipelineClient rows={rows} sources={sources} filters={filters} />
    </>
  )
}
