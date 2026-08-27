import type { Metro, Status, Tier } from '@/db/enums'
import { METRO_LABELS } from '@/config/metros'
import { STATUS_LABELS } from '@/lib/status'

const STATUS_CLASS: Record<Status, string> = {
  sourced: 'st-idle',
  qualified: 'st-live',
  dmed: 'st-live',
  replied: 'st-hot',
  call_booked: 'st-hot',
  demo_given: 'st-hot',
  loi_sent: 'st-hot',
  signed: 'st-win',
  declined: 'st-out',
  rejected: 'st-out',
  no_response: 'st-idle',
  banked: 'st-idle',
}

export function StatusChip({ status }: { status: Status }) {
  return <span className={`chip ${STATUS_CLASS[status]}`}>{STATUS_LABELS[status]}</span>
}

export function TierChip({ tier, score }: { tier: Tier | null; score?: number | null }) {
  if (!tier) return <span className="dim">—</span>
  return (
    <span className={`chip tier-${tier}`}>
      {tier}
      {score !== null && score !== undefined ? <span className="num"> {score}</span> : null}
    </span>
  )
}

export function MetroChip({ metro }: { metro: Metro | null }) {
  if (!metro) return <span className="dim">—</span>
  return <span className="chip plain">{METRO_LABELS[metro]}</span>
}

export function KeyHint({ children }: { children: React.ReactNode }) {
  return <kbd className="keyhint">{children}</kbd>
}
