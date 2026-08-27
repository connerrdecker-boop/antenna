import type { FunnelStats } from '@/db/repo'
import { FUNNEL_ORDER, OFF_FUNNEL, STATUS_LABELS } from '@/lib/status'

/**
 * Part 8.1: "Funnel strip on top: counts per status + stage-to-stage conversion %."
 *
 * Counts are CURRENT occupancy. Conversion is computed from status_history
 * (candidates that EVER reached each stage), because a signed candidate no
 * longer sits at `dmed` but certainly converted through it.
 */
export function FunnelStrip({ stats }: { stats: FunnelStats }) {
  return (
    <>
      <div className="funnel">
        {FUNNEL_ORDER.map((status, i) => {
          const conv = stats.conversions[i]
          const count = stats.current[status]
          return (
            <div key={status} className={`funnel-stage${count === 0 ? ' zero' : ''}`}>
              <div className="fs-body">
                <div className="fs-label">{STATUS_LABELS[status]}</div>
                <div className="fs-count num">{count}</div>
              </div>
              {conv ? (
                <div
                  className="fs-conv"
                  title={`${stats.everReached[conv.from]} ever reached ${STATUS_LABELS[conv.from]} → ${stats.everReached[conv.to]} reached ${STATUS_LABELS[conv.to]}`}
                >
                  <b className="num">{conv.pct === null ? '—' : `${Math.round(conv.pct)}%`}</b>
                  <br />
                  →{STATUS_LABELS[conv.to].toLowerCase()}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
      <div className="funnel-off">
        <span>Off-funnel:</span>
        {OFF_FUNNEL.map((s) => (
          <span key={s}>
            {STATUS_LABELS[s]} <b className="num">{stats.current[s]}</b>
          </span>
        ))}
        <span style={{ marginLeft: 'auto' }}>
          Total <b className="num">{stats.total}</b>
        </span>
      </div>
    </>
  )
}
