'use client'
/**
 * The harvest cockpit (/settings). Flow per adapter: pick metro + provider →
 * Estimate (free) → the cost and scope appear → Confirm run. The estimate is
 * always shown BEFORE the confirm button becomes active (Part XIII A3).
 */
import { useState } from 'react'
import { estimateRun, runAdapter, type EstimateData, type RunData } from '@/app/settings/actions'
import type { HarvestRunRow } from '@/db/metrics'

const usd = (v: number) => `$${v.toFixed(2)}`
const stamp = (iso: string) => iso.replace('T', ' ').slice(0, 16)

const ADAPTER_INFO = [
  { name: 'serper', label: 'Seller-exhaust search (4a — PRIMARY)', category: 'serp', desc: 'SERP queries against the public footprints of selling: Stan Store, Linktree, Beacons, comment-word CTAs.' },
  { name: 'hashtags', label: 'Hashtag mining (4b — SECONDARY)', category: 'actors', desc: 'No-login data actor over the starter hashtag library. Expect flakiness; Score filters.' },
  { name: 'commenters', label: 'Commenters / tagged (4c — STRETCH)', category: 'actors', desc: 'Commenters of seed-list coaches. Seed list is operator-filled (config/seeds.ts).' },
] as const

type Drafts = {
  queries: boolean; hashtags: boolean; seeds: boolean
  seedCounts: { nyc: number; sofla: number }
  actor: boolean; actorId: string
}

export function SettingsClient({
  keys, drafts, spend, runs,
}: {
  keys: Record<string, boolean>
  drafts: Drafts
  spend: { byCategory: { category: string; spent: number }[]; total: number; caps: Record<string, number> }
  runs: HarvestRunRow[]
}) {
  return (
    <div className="settings-grid">
      <div>
        {ADAPTER_INFO.map((a) => (
          <AdapterCard key={a.name} info={a} drafts={drafts} />
        ))}
      </div>
      <div>
        <section className="card pad sec">
          <h3>Keys (.env.local — presence only, values never shown)</h3>
          <table className="dense">
            <tbody>
              {Object.entries(keys).map(([key, present]) => (
                <tr key={key}>
                  <td><code>{key}</code></td>
                  <td className="r">{present
                    ? <span className="chip st-win">set</span>
                    : <span className="chip st-out">missing</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="card pad sec">
          <h3>Ratification gates (Part XV.8)</h3>
          <table className="dense">
            <tbody>
              <tr><td>Query library</td><td className="r">{drafts.queries ? <span className="chip st-hot">DRAFT</span> : <span className="chip st-win">ratified</span>}</td></tr>
              <tr><td>Hashtag library</td><td className="r">{drafts.hashtags ? <span className="chip st-hot">DRAFT</span> : <span className="chip st-win">ratified</span>}</td></tr>
              <tr><td>Seed list</td><td className="r"><span className="dim num">nyc {drafts.seedCounts.nyc} · sofla {drafts.seedCounts.sofla}</span> {drafts.seeds ? <span className="chip st-hot">DRAFT</span> : <span className="chip st-win">ratified</span>}</td></tr>
              <tr><td>Profile actor <span className="dim">{drafts.actorId}</span></td><td className="r">{drafts.actor ? <span className="chip st-hot">DRAFT</span> : <span className="chip st-win">ratified</span>}</td></tr>
            </tbody>
          </table>
          <p className="terminal-note">Real providers refuse to spend while their library is DRAFT — fixture runs are always available.</p>
          <p className="terminal-note">The actor is ratified by passing <code>npm run smoke:actor</code> (≤ $2) in front of you — Part 4b. Until then scale runs refuse.</p>
        </section>

        <section className="card pad sec">
          <h3>Spend vs caps (Law 6)</h3>
          <table className="dense">
            <tbody>
              {(['serp', 'actors', 'llm'] as const).map((cat) => (
                <tr key={cat}>
                  <td>{cat}</td>
                  <td className="r num">{usd(spend.byCategory.find((r) => r.category === cat)?.spent ?? 0)}</td>
                  <td className="r num dim">/ {usd(spend.caps[cat])}</td>
                </tr>
              ))}
              <tr><td><b>total</b></td><td className="r num"><b>{usd(spend.total)}</b></td><td className="r num dim">/ {usd(spend.caps.total)}</td></tr>
            </tbody>
          </table>
        </section>

        <section className="card pad sec" style={{ marginBottom: 0 }}>
          <h3>Recent runs</h3>
          {runs.length === 0 ? <p className="terminal-note">No harvest runs yet.</p> : (
            <table className="dense">
              <thead><tr><th>#</th><th>Adapter</th><th>When</th><th className="r">Found</th><th className="r">New</th><th>Status</th></tr></thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} title={r.error ?? undefined}>
                    <td className="num">{r.id}</td>
                    <td>{r.adapter}<span className="dim"> {r.provider ?? ''}</span></td>
                    <td className="num">{stamp(r.started_at)}</td>
                    <td className="r num">{r.items_found ?? '—'}</td>
                    <td className="r num">{r.items_new ?? '—'}</td>
                    <td>{r.status === 'ok' ? <span className="chip st-win">ok</span> : r.status === 'failed' ? <span className="chip st-out">failed</span> : <span className="chip st-idle">running</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  )
}

function AdapterCard({ info, drafts }: { info: (typeof ADAPTER_INFO)[number]; drafts: Drafts }) {
  const [metro, setMetro] = useState<'nyc' | 'sofla'>('nyc')
  const [provider, setProvider] = useState<'fixture' | 'real'>('fixture')
  const [estimate, setEstimate] = useState<EstimateData | null>(null)
  const [result, setResult] = useState<RunData | null>(null)
  const [error, setError] = useState<{ message: string; halt: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  const resetOutputs = () => { setEstimate(null); setResult(null); setError(null) }

  const doEstimate = async () => {
    setBusy(true); setError(null); setResult(null)
    const res = await estimateRun(info.name, metro, provider)
    setBusy(false)
    if (!res.ok) return setError({ message: res.error, halt: false })
    setEstimate(res.data)
  }

  const doRun = async () => {
    if (!estimate) return
    setBusy(true); setError(null)
    const res = await runAdapter(info.name, metro, provider)
    setBusy(false)
    if (!res.ok) return setError({ message: res.error, halt: res.halt ?? false })
    setResult(res.data)
  }

  return (
    <section className="card pad sec">
      <h3>{info.label} <span className="chip plain">{info.category}</span></h3>
      <p className="dim" style={{ marginTop: 0 }}>{info.desc}</p>
      <div className="btnrow">
        <label className="dim">Metro</label>
        <select value={metro} onChange={(e) => { setMetro(e.target.value as 'nyc' | 'sofla'); resetOutputs() }}>
          <option value="nyc">NYC</option>
          <option value="sofla">SoFla</option>
        </select>
        <label className="dim">Provider</label>
        <select value={provider} onChange={(e) => { setProvider(e.target.value as 'fixture' | 'real'); resetOutputs() }}>
          <option value="fixture">fixture (free, offline)</option>
          <option value="real">real (spends money)</option>
        </select>
        <button type="button" className="btn" disabled={busy} onClick={() => void doEstimate()}>Estimate</button>
        <button
          type="button"
          className="btn primary"
          disabled={busy || !estimate}
          title={estimate ? undefined : 'Estimate first — the cost is shown before you confirm'}
          onClick={() => void doRun()}
        >
          {busy ? 'Running…' : `Confirm run${estimate ? ` (${provider === 'fixture' ? '$0.00 — est ' : ''}${usd(estimate.estCost)})` : ''}`}
        </button>
      </div>

      {estimate && !result ? (
        <p className="warnbox" style={{ marginTop: 8 }}>
          Estimated cost of a REAL run: <b className="num">{usd(estimate.estCost)}</b> — {estimate.detail}.
          {provider === 'fixture' ? ' This fixture run spends $0.00.' : ' Confirm charges toward the category cap.'}
        </p>
      ) : null}

      {error ? (
        <div className={error.halt ? 'warnbox' : 'err'} style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>
          {error.halt ? '■ HALT — ' : ''}{error.message}
        </div>
      ) : null}

      {result ? (
        <div className="ok" style={{ marginTop: 8 }}>
          run #{result.runId}: found <b className="num">{result.itemsFound}</b> · new{' '}
          <b className="num">{result.itemsNew}</b> · duplicates <b className="num">{result.duplicates}</b> ·
          unusable <b className="num">{result.unusable}</b> · spent <b className="num">{usd(result.spentActual)}</b>
          {' '}— <a href="/pipeline?status=sourced">see them in the pipeline →</a>
          <div className="log" style={{ marginTop: 6 }}>
            {result.log.map((l, i) => <div key={i} className="dim">{l}</div>)}
          </div>
        </div>
      ) : null}
    </section>
  )
}
