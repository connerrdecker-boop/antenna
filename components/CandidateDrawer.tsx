'use client'
import { useCallback, useEffect, useState, useTransition } from 'react'
import {
  addOutreachEntry, doTransition, fetchDetail, saveNextAction, saveNotes,
} from '@/app/actions'
import { MetroChip, StatusChip, TierChip } from '@/components/Chip'
import { LOI_TIERS, LOI_TIER_LABELS, type LoiTier, type Status } from '@/db/enums'
import type { CandidateDetail } from '@/db/repo'
import { STATUS_LABELS, TERMINAL_STATUSES } from '@/lib/status'

const fmt = new Intl.NumberFormat('en-US')
const stamp = (iso: string | null) => (iso ? iso.replace('T', ' ').slice(0, 16) : '—')

export function CandidateDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const [detail, setDetail] = useState<CandidateDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [pending, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)

  const [notes, setNotes] = useState('')
  const [nextAction, setNextAction] = useState('')
  const [transitionNote, setTransitionNote] = useState('')
  const [loiTier, setLoiTier] = useState<LoiTier>('t1')
  const [outText, setOutText] = useState('')
  const [outDir, setOutDir] = useState<'out' | 'in'>('out')

  const load = useCallback(async () => {
    const res = await fetchDetail(id)
    if (!res.ok) return setError(res.error)
    if (!res.data) return setNotFound(true)
    setDetail(res.data)
    setNotes(res.data.candidate.notes ?? '')
    setNextAction(res.data.candidate.nextActionDate ?? '')
    if (res.data.candidate.loiTier) setLoiTier(res.data.candidate.loiTier)
  }, [id])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (e.key === 'Escape' && !(el && /^(INPUT|TEXTAREA)$/.test(el.tagName))) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const applied = <T,>(res: { ok: true; data: T } | { ok: false; error: string }, after?: (d: T) => void) => {
    if (!res.ok) setError(res.error)
    else { setError(null); after?.(res.data) }
    setBusy(false)
  }

  const move = (to: Status) => {
    setBusy(true)
    startTransition(async () => {
      const res = await doTransition(id, to, transitionNote, to === 'signed' ? loiTier : undefined)
      applied(res, (d) => { if (d) { setDetail(d); setTransitionNote('') } })
    })
  }

  if (notFound) {
    return (
      <Shell onClose={onClose} title={`#${id}`}>
        <div className="err">Candidate {id} no longer exists.</div>
      </Shell>
    )
  }
  if (!detail) {
    return <Shell onClose={onClose} title="Loading…"><p className="sub">Reading the row…</p></Shell>
  }

  const c = detail.candidate
  const isTerminal = (TERMINAL_STATUSES as readonly string[]).includes(c.status)

  return (
    <Shell
      onClose={onClose}
      title={c.handle}
      badges={<><TierChip tier={c.tier} score={c.score} /> <StatusChip status={c.status} /></>}
    >
      {error ? <div className="err">{error}</div> : null}

      {detail.linkTwins.length ? (
        <div className="warnbox">
          Shares a link page with {detail.linkTwins.map((t) => t.handle).join(', ')} — flagged for
          manual merge (Part III). Antenna never auto-merges.
        </div>
      ) : null}

      <section className="sec">
        <h3>Link-outs</h3>
        <div className="btnrow">
          <a className="btn" href={c.igUrl ?? `https://www.instagram.com/${c.handle}/`} target="_blank" rel="noreferrer">
            Instagram profile ↗
          </a>
          {c.linkUrl ? <a className="btn" href={c.linkUrl} target="_blank" rel="noreferrer">Link page ↗</a> : null}
        </div>
      </section>

      <section className="sec">
        <h3>Facts</h3>
        <dl className="kv">
          <dt>Followers</dt><dd className="num">{c.followerCount === null ? '—' : fmt.format(c.followerCount)}</dd>
          <dt>Metro</dt>
          <dd>
            <MetroChip metro={c.metro} />
            {c.metroConfidence !== null ? <span className="dim num"> conf {c.metroConfidence.toFixed(2)}</span> : null}
          </dd>
          <dt>Source</dt><dd>{c.source}{c.sourceDetail ? <span className="dim"> · {c.sourceDetail}</span> : null}</dd>
          <dt>First seen</dt><dd className="num">{stamp(c.firstSeen)}</dd>
          <dt>Days in status</dt><dd className="num">{detail.daysInStatus ?? '—'}</dd>
          <dt>Follow-ups</dt><dd className="num">{c.followupCount}</dd>
          <dt>Pre-score</dt><dd className="num">{c.preScore ?? '—'}</dd>
          <dt>Score</dt><dd className="num">{c.score ?? '—'}{c.scorePromptVersion ? <span className="dim"> · {c.scorePromptVersion}</span> : null}</dd>
          <dt>Last enriched</dt><dd className="num">{stamp(c.lastEnriched)}</dd>
          {c.linkDomain ? <><dt>Link domain</dt><dd>{c.linkDomain}<span className="dim"> · fetch {c.linkFetchStatus ?? '—'}</span></dd></> : null}
          {c.loiTier ? <><dt>LOI tier</dt><dd>{LOI_TIER_LABELS[c.loiTier]}</dd></> : null}
          {c.bio ? <><dt>Bio</dt><dd>{c.bio}</dd></> : null}
        </dl>
      </section>

      <section className="sec">
        <h3>Hook draft</h3>
        {c.hookDraft
          ? <div className="hook">{c.hookDraft}</div>
          : <p className="terminal-note">No hook yet — scoring arrives in A2.</p>}
      </section>

      <section className="sec">
        <h3>Evidence</h3>
        {detail.evidence.length
          ? <ul className="evidence">{detail.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>
          : <p className="terminal-note">No evidence yet — the full scorer writes this in A2.</p>}
        {detail.stackSignals.length ? (
          <p style={{ marginBottom: 0 }}>
            {detail.stackSignals.map((s) => <span key={s} className="chip plain" style={{ marginRight: 4 }}>{s}</span>)}
          </p>
        ) : null}
        {detail.extracted?.offers?.length ? (
          <ul className="evidence">
            {detail.extracted.offers.map((o, i) => (
              <li key={i}>{o.type}{o.price ? ` — ${o.price}` : ''}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="sec">
        <h3>Status controls</h3>
        {isTerminal ? (
          <p className="terminal-note">
            {STATUS_LABELS[c.status]} is terminal (Part 8.2) — no transitions out.
          </p>
        ) : (
          <>
            <input
              className="text"
              placeholder="Optional note for the history row…"
              value={transitionNote}
              onChange={(e) => setTransitionNote(e.target.value)}
              style={{ marginBottom: 6 }}
            />
            <div className="btnrow">
              {detail.legalTransitions.map((t) => (
                <span key={t} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                  {t === 'signed' ? (
                    <select value={loiTier} onChange={(e) => setLoiTier(e.target.value as LoiTier)}>
                      {LOI_TIERS.map((lt) => <option key={lt} value={lt}>{LOI_TIER_LABELS[lt]}</option>)}
                    </select>
                  ) : null}
                  <button
                    type="button"
                    className={`btn${t === 'signed' ? ' primary' : ''}${t === 'rejected' || t === 'declined' ? ' danger' : ''}`}
                    disabled={busy || pending}
                    onClick={() => move(t)}
                  >
                    → {STATUS_LABELS[t]}
                  </button>
                </span>
              ))}
            </div>
            <p className="terminal-note" style={{ marginTop: 6 }}>
              Only Part 8.2 transitions are offered. <b>Rejected</b> = we disqualified;{' '}
              <b>Declined</b> = they said no.
            </p>
          </>
        )}
      </section>

      <section className="sec">
        <h3>Notes</h3>
        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="btnrow" style={{ marginTop: 6 }}>
          <button
            type="button" className="btn" disabled={busy || pending}
            onClick={() => { setBusy(true); startTransition(async () => applied(await saveNotes(id, notes), () => void load())) }}
          >
            Save notes
          </button>
          <span style={{ flex: 1 }} />
          <label className="dim" style={{ alignSelf: 'center', fontSize: 11 }}>Next action</label>
          <input
            className="text" type="date" style={{ width: 150 }}
            value={nextAction} onChange={(e) => setNextAction(e.target.value)}
          />
          <button
            type="button" className="btn" disabled={busy || pending}
            onClick={() => { setBusy(true); startTransition(async () => applied(await saveNextAction(id, nextAction), () => void load())) }}
          >
            Set
          </button>
        </div>
      </section>

      <section className="sec">
        <h3>Outreach log</h3>
        <div className="log">
          {detail.outreach.length === 0 ? <p className="terminal-note">Nothing logged yet.</p> : null}
          {detail.outreach.map((o) => (
            <div key={o.id} className="log-row">
              <time>{stamp(o.at)}</time>
              <span className={`chip ${o.direction === 'out' ? 'st-live' : 'st-win'}`}>{o.direction}</span>
              <span className="body">{o.text}</span>
            </div>
          ))}
        </div>
        <div className="btnrow" style={{ marginTop: 6 }}>
          <select value={outDir} onChange={(e) => setOutDir(e.target.value as 'out' | 'in')}>
            <option value="out">out</option>
            <option value="in">in</option>
          </select>
          <input
            className="text" style={{ flex: 1, minWidth: 160 }}
            placeholder="Paste what was actually sent or received…"
            value={outText} onChange={(e) => setOutText(e.target.value)}
          />
          <button
            type="button" className="btn" disabled={busy || pending || !outText.trim()}
            onClick={() => {
              setBusy(true)
              startTransition(async () => applied(await addOutreachEntry(id, outDir, outText), (d) => { if (d) { setDetail(d); setOutText('') } }))
            }}
          >
            Log
          </button>
        </div>
      </section>

      <section className="sec">
        <h3>Status history</h3>
        <div className="log">
          {detail.history.map((h) => (
            <div key={h.id} className="log-row">
              <time>{stamp(h.at)}</time>
              <span className="body">
                {h.fromStatus ? `${STATUS_LABELS[h.fromStatus]} → ` : ''}
                <b>{STATUS_LABELS[h.toStatus]}</b>
                {h.note ? <span className="dim"> · {h.note}</span> : null}
              </span>
            </div>
          ))}
        </div>
      </section>

      {detail.ratifications.length ? (
        <section className="sec">
          <h3>Ratifications</h3>
          <div className="log">
            {detail.ratifications.map((r) => (
              <div key={r.id} className="log-row">
                <time>{stamp(r.at)}</time>
                <span className="body"><b>{r.decision}</b>{r.reason ? <span className="dim"> · {r.reason}</span> : null}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </Shell>
  )
}

function Shell({
  onClose, title, badges, children,
}: {
  onClose: () => void
  title: string
  badges?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={`Candidate ${title}`}>
        <div className="drawer-head">
          <span className="h">{title}</span>
          {badges}
          <button type="button" className="drawer-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  )
}
