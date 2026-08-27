'use client'
import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CandidateDrawer } from '@/components/CandidateDrawer'
import { MetroChip, StatusChip, TierChip } from '@/components/Chip'
import { METROS, STATUSES, TIERS } from '@/db/enums'
import type { PipelineFilters, PipelineRow } from '@/db/repo'
import { METRO_LABELS } from '@/config/metros'
import { STATUS_LABELS } from '@/lib/status'

const fmt = new Intl.NumberFormat('en-US')

/**
 * The LOCAL calendar date. next_action_date comes from <input type="date">, which
 * is local; comparing it against a UTC date marks tomorrow's actions overdue
 * from 20:00 local onward — which is exactly the evening window Conner works in.
 */
const today = () => new Date().toLocaleDateString('en-CA')

export function PipelineClient({
  rows, sources, filters,
}: {
  rows: PipelineRow[]
  sources: string[]
  filters: PipelineFilters
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [openId, setOpenId] = useState<number | null>(null)
  const [cursor, setCursor] = useState(0)

  const setFilter = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString())
      if (!value || value === 'all') next.delete(key)
      else next.set(key, value)
      router.push(next.toString() ? `/pipeline?${next}` : '/pipeline')
    },
    [params, router],
  )

  // Filtering can leave the cursor past the end of the shorter list.
  useEffect(() => {
    setCursor((c) => (rows.length === 0 ? 0 : Math.min(c, rows.length - 1)))
  }, [rows.length])

  // Cockpit keys: j/k walk the table, Enter opens the drawer.
  //
  // Two things this must NOT do. It must not stay armed while the drawer is
  // open — the drawer is modal and owns the keyboard, including Esc; leaving
  // this listener live let Enter swap the drawer to a different candidate
  // without remounting it. And it must not preventDefault on an interactive
  // target: cancelling keydown on a focused button or link suppresses the
  // activation click and the href, so Enter would do nothing anywhere on the page.
  useEffect(() => {
    if (openId !== null) return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el?.closest('input, textarea, select, button, a, [contenteditable]')) return
      if (!rows.length) return
      if (e.key === 'j') { e.preventDefault(); setCursor((c) => Math.min(rows.length - 1, c + 1)) }
      else if (e.key === 'k') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)) }
      else if (e.key === 'Enter') { e.preventDefault(); setOpenId(rows[cursor]?.id ?? null) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rows, cursor, openId])

  const active = Object.entries(filters).filter(([, v]) => v && v !== 'all')

  return (
    <>
      <div className="filters">
        <label htmlFor="f-status">Status</label>
        <select id="f-status" value={filters.status ?? 'all'} onChange={(e) => setFilter('status', e.target.value)}>
          <option value="all">All</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>

        <label htmlFor="f-tier">Tier</label>
        <select id="f-tier" value={filters.tier ?? 'all'} onChange={(e) => setFilter('tier', e.target.value)}>
          <option value="all">All</option>
          {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>

        <label htmlFor="f-metro">Metro</label>
        <select id="f-metro" value={filters.metro ?? 'all'} onChange={(e) => setFilter('metro', e.target.value)}>
          <option value="all">All</option>
          {METROS.map((m) => <option key={m} value={m}>{METRO_LABELS[m]}</option>)}
        </select>

        <label htmlFor="f-source">Source</label>
        <select id="f-source" value={filters.source ?? 'all'} onChange={(e) => setFilter('source', e.target.value)}>
          <option value="all">All</option>
          {sources.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        {active.length ? (
          <button type="button" className="linkish" onClick={() => router.push('/pipeline')}>
            clear {active.length} filter{active.length > 1 ? 's' : ''}
          </button>
        ) : null}

        <span className="count num">
          {rows.length} row{rows.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="card tablewrap">
        <table className="dense">
          <thead>
            <tr>
              <th>Handle</th>
              <th>Tier</th>
              <th className="r">Followers</th>
              <th>Metro</th>
              <th>Status</th>
              <th className="r">Days in</th>
              <th>Next action</th>
              <th className="r">F/U</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const overdue = r.nextActionDate !== null && r.nextActionDate <= today()
              return (
                <tr
                  key={r.id}
                  className={openId === r.id || cursor === i ? 'selected' : ''}
                  onClick={() => { setCursor(i); setOpenId(r.id) }}
                >
                  <td className="handle">{r.handle}</td>
                  <td><TierChip tier={r.tier} score={r.score} /></td>
                  <td className="r num">{r.followerCount === null ? <span className="dim">—</span> : fmt.format(r.followerCount)}</td>
                  <td><MetroChip metro={r.metro} /></td>
                  <td><StatusChip status={r.status} /></td>
                  <td className="r num">{r.daysInStatus ?? <span className="dim">—</span>}</td>
                  <td className={overdue ? 'num' : 'num dim'} style={overdue ? { color: 'var(--warn)', fontWeight: 600 } : undefined}>
                    {r.nextActionDate ?? '—'}
                  </td>
                  <td className="r num">{r.followupCount}</td>
                  <td className="dim">{r.source}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <div className="empty">
            No candidates match. {active.length ? 'Loosen a filter, or ' : ''}
            add some on <a href="/add">/add</a>.
          </div>
        ) : null}
      </div>

      {/* key: a different candidate gets a FRESH instance. Without it React reuses
          the component and the previous candidate's LOI tier, error banner and
          not-found state ride along onto the next one. */}
      {openId !== null ? <CandidateDrawer key={openId} id={openId} onClose={() => setOpenId(null)} /> : null}
    </>
  )
}
