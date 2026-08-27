'use client'
/**
 * PART VII — the ratify queue. Target: 100 profiles in ~20 minutes, so the
 * keyboard is the interface and the mouse is optional.
 *
 *   y approve -> qualified      n reject -> reason picker -> rejected
 *   b bank -> banked            f flag (closer look; stays in queue)
 *   j/k navigate                u undo last
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { rate, undo } from '@/app/ratify/actions'
import { MetroChip, TierChip } from '@/components/Chip'
import { REJECT_REASONS, type Decision } from '@/db/enums'
import type { RatifyCard } from '@/db/repo'

const fmt = new Intl.NumberFormat('en-US')

type LastAction = {
  card: RatifyCard
  index: number
  ratificationId: number
  decision: Decision
}

export function RatifyClient({ initialQueue }: { initialQueue: RatifyCard[] }) {
  const [queue, setQueue] = useState<RatifyCard[]>(initialQueue)
  const [cursor, setCursor] = useState(0)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [last, setLast] = useState<LastAction | null>(null)
  const [done, setDone] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const current = queue[cursor] ?? null

  // Keep the highlighted card in view as j/k walks the list.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${cursor}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const decide = useCallback(
    async (decision: Decision, reason?: string) => {
      if (!current || busy) return
      setBusy(true)
      setError(null)
      const res = await rate(current.id, decision, reason)
      setBusy(false)
      if (!res.ok) return setError(res.error)

      setLast({ card: current, index: cursor, ratificationId: res.data.ratificationId, decision })
      setDone((d) => d + 1)
      if (decision === 'flag') {
        // Stays in the queue, badged; move along.
        setQueue((q) => q.map((c, i) => (i === cursor ? { ...c, flagged: true } : c)))
        setCursor((c) => Math.min(c + 1, queue.length - 1))
      } else {
        setQueue((q) => q.filter((_, i) => i !== cursor))
        setCursor((c) => Math.min(c, queue.length - 2 < 0 ? 0 : queue.length - 2))
      }
      setPickerOpen(false)
    },
    [current, cursor, busy, queue.length],
  )

  const undoLast = useCallback(async () => {
    if (!last || busy) return
    setBusy(true)
    setError(null)
    const res = await undo(last.card.id, last.ratificationId)
    setBusy(false)
    if (!res.ok) return setError(res.error)
    if (last.decision === 'flag') {
      setQueue((q) => q.map((c) => (c.id === last.card.id ? { ...c, flagged: false } : c)))
    } else {
      // Back into the queue at its old position.
      setQueue((q) => {
        const next = [...q]
        next.splice(Math.min(last.index, next.length), 0, last.card)
        return next
      })
      setCursor(Math.min(last.index, queue.length))
    }
    setDone((d) => Math.max(0, d - 1))
    setLast(null)
  }, [last, busy, queue.length])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el?.closest('input, textarea, select, [contenteditable]')) return

      if (pickerOpen) {
        // Reason picker owns the keyboard: 1-7 pick, Escape cancels.
        if (e.key === 'Escape') { e.preventDefault(); setPickerOpen(false); return }
        const n = Number(e.key)
        if (n >= 1 && n <= REJECT_REASONS.length) {
          e.preventDefault()
          void decide('reject', REJECT_REASONS[n - 1])
        }
        return
      }

      switch (e.key) {
        case 'j': e.preventDefault(); setCursor((c) => Math.min(queue.length - 1, c + 1)); break
        case 'k': e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); break
        case 'y': e.preventDefault(); void decide('approve'); break
        case 'n': e.preventDefault(); if (queue[cursor]) setPickerOpen(true); break
        case 'b': e.preventDefault(); void decide('bank'); break
        case 'f': e.preventDefault(); void decide('flag'); break
        case 'u': e.preventDefault(); void undoLast(); break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [queue, cursor, pickerOpen, decide, undoLast])

  const tierCounts = useMemo(() => {
    const t: Record<string, number> = { A: 0, B: 0, C: 0, X: 0 }
    for (const c of queue) t[c.tier] = (t[c.tier] ?? 0) + 1
    return t
  }, [queue])

  if (!queue.length) {
    return (
      <div className="card pad">
        <p style={{ margin: 0 }}>
          Queue clear — <b className="num">{done}</b> decided this session. Scored candidates land
          here; run <code>npm run pipeline</code> to feed it.
        </p>
      </div>
    )
  }

  return (
    <>
      {error ? <div className="err">{error}</div> : null}
      <div className="funnel-off" style={{ marginBottom: 8 }}>
        <span>In queue <b className="num">{queue.length}</b></span>
        {(['A', 'B', 'C', 'X'] as const).map((t) => (
          <span key={t}>{t} <b className="num">{tierCounts[t]}</b></span>
        ))}
        <span style={{ marginLeft: 'auto' }}>Decided <b className="num">{done}</b>{last ? <> · <kbd className="keyhint">u</kbd> undoes {last.card.handle}</> : null}</span>
      </div>

      <div className="ratify-grid">
        <div className="card ratify-list" ref={listRef}>
          {queue.map((c, i) => (
            <button
              key={c.id}
              type="button"
              data-idx={i}
              className={`ratify-card${i === cursor ? ' current' : ''}`}
              onClick={() => setCursor(i)}
            >
              <span className="handle">{c.handle}</span>
              <TierChip tier={c.tier} score={c.score} />
              <span className="num dim">{c.followerCount === null ? '—' : fmt.format(c.followerCount)}</span>
              <MetroChip metro={c.metro} />
              {c.flagged ? <span className="chip st-hot">flagged</span> : null}
              <span className="ratify-hook">{c.hookDraft ?? ''}</span>
            </button>
          ))}
        </div>

        {current ? <EvidencePanel card={current} busy={busy} onDecide={decide} onPicker={() => setPickerOpen(true)} /> : null}
      </div>

      {pickerOpen && current ? (
        <>
          <div className="scrim" onClick={() => setPickerOpen(false)} />
          <div className="picker" role="dialog" aria-label="Reject reason">
            <h3>Reject {current.handle} — why?</h3>
            {REJECT_REASONS.map((r, i) => (
              <button key={r} type="button" className="btn picker-row" disabled={busy} onClick={() => void decide('reject', r)}>
                <kbd className="keyhint">{i + 1}</kbd> {r}
              </button>
            ))}
            <p className="terminal-note"><kbd className="keyhint">Esc</kbd> cancel — the reason is the training signal.</p>
          </div>
        </>
      ) : null}
    </>
  )
}

function EvidencePanel({
  card, busy, onDecide, onPicker,
}: {
  card: RatifyCard
  busy: boolean
  onDecide: (d: Decision, reason?: string) => void
  onPicker: () => void
}) {
  // Structured evidence lines: "GATE name: PASS — …" / "DIM name 22/25 — …".
  const groups = useMemo(() => {
    const gates: string[] = []
    const dims: string[] = []
    const other: string[] = []
    for (const line of card.evidence) {
      if (line.startsWith('GATE ')) gates.push(line.slice(5))
      else if (line.startsWith('DIM ')) dims.push(line.slice(4))
      else if (line.startsWith('PENALTY ')) dims.push(line.slice(8))
      else other.push(line)
    }
    return { gates, dims, other }
  }, [card.evidence])

  return (
    <div className="card pad ratify-evidence">
      <div className="drawer-head" style={{ margin: '-12px -12px 10px', borderRadius: '4px 4px 0 0' }}>
        <span className="h">{card.handle}</span>
        <TierChip tier={card.tier} score={card.score} />
        <MetroChip metro={card.metro} />
        {card.metroConfidence !== null ? <span className="dim num">conf {card.metroConfidence.toFixed(2)}</span> : null}
        <span style={{ flex: 1 }} />
        <a className="btn tiny" href={card.igUrl ?? `https://www.instagram.com/${card.handle}/`} target="_blank" rel="noreferrer">IG ↗</a>
        {card.linkUrl ? <a className="btn tiny" href={card.linkUrl} target="_blank" rel="noreferrer">{card.linkDomain ?? 'link'} ↗</a> : null}
      </div>

      {card.bio ? <p style={{ marginTop: 0 }}>{card.bio}</p> : null}

      {card.hookDraft ? (
        <section className="sec">
          <h3>Hook</h3>
          <div className="hook">{card.hookDraft}</div>
        </section>
      ) : null}

      {groups.gates.length ? (
        <section className="sec">
          <h3>Gates</h3>
          <ul className="evidence">
            {groups.gates.map((g, i) => (
              <li key={i} className={g.includes(': FAIL') ? 'gate-fail' : undefined}>{g}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {groups.dims.length ? (
        <section className="sec">
          <h3>Rubric</h3>
          <ul className="evidence">{groups.dims.map((d, i) => <li key={i}>{d}</li>)}</ul>
        </section>
      ) : null}

      {groups.other.length ? (
        <section className="sec">
          <h3>Evidence</h3>
          <ul className="evidence">{groups.other.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </section>
      ) : null}

      {card.extracted?.offers?.length || card.stackSignals.length ? (
        <section className="sec">
          <h3>Offers &amp; stack</h3>
          {card.extracted?.offers?.length ? (
            <ul className="evidence">
              {card.extracted.offers.map((o, i) => <li key={i}>{o.type}{o.price ? ` — ${o.price}` : ''}</li>)}
            </ul>
          ) : null}
          {card.stackSignals.map((s) => <span key={s} className="chip plain" style={{ marginRight: 4 }}>{s}</span>)}
        </section>
      ) : null}

      <div className="btnrow" style={{ marginTop: 12 }}>
        <button type="button" className="btn primary" disabled={busy} onClick={() => onDecide('approve')}><kbd className="keyhint">y</kbd> Approve</button>
        <button type="button" className="btn danger" disabled={busy} onClick={onPicker}><kbd className="keyhint">n</kbd> Reject…</button>
        <button type="button" className="btn" disabled={busy} onClick={() => onDecide('bank')}><kbd className="keyhint">b</kbd> Bank</button>
        <button type="button" className="btn" disabled={busy} onClick={() => onDecide('flag')}><kbd className="keyhint">f</kbd> Flag</button>
      </div>
    </div>
  )
}
