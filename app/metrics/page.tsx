import { FunnelStrip } from '@/components/FunnelStrip'
import { dmsPerDay, replyStats, sourceQualification, spendSummary } from '@/db/metrics'
import { funnelStats } from '@/db/repo'
import { CAPS } from '@/config/limits'

export const dynamic = 'force-dynamic'

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`)
const usd = (v: number) => `$${v.toFixed(2)}`

export default function MetricsPage() {
  const sources = sourceQualification()
  const spend = spendSummary()
  const dms = dmsPerDay()
  const replies = replyStats()
  const funnel = funnelStats()

  return (
    <>
      <h1 className="h1">Metrics</h1>
      <p className="sub">
        Wave two gets planned from this screen, not from vibes (Part 8.4). Every number is live
        DB data; a — means the data does not exist yet, never zero-padded theater.
      </p>

      <section className="sec">
        <h3>Funnel</h3>
        <FunnelStrip stats={funnel} />
      </section>

      <div className="metrics-grid">
        <section className="card pad sec" style={{ marginBottom: 0 }}>
          <h3>Per-source qualification — the empirical market-size test</h3>
          <table className="dense">
            <thead>
              <tr><th>Source</th><th className="r">Candidates</th><th className="r">Decided</th><th className="r">Qualified</th><th className="r">Rate</th></tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.source}>
                  <td>{s.source}</td>
                  <td className="r num">{s.candidates}</td>
                  <td className="r num">{s.decided}</td>
                  <td className="r num">{s.everQualified}</td>
                  <td className="r num">{pct(s.rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {sources.every((s) => s.decided === 0) ? (
            <p className="terminal-note">Rates appear once the ratify queue has decided candidates from each source.</p>
          ) : null}
        </section>

        <section className="card pad sec" style={{ marginBottom: 0 }}>
          <h3>Spend &amp; cost per qualified</h3>
          <table className="dense">
            <thead><tr><th>Category</th><th className="r">Spent</th><th className="r">Cap</th></tr></thead>
            <tbody>
              {(['serp', 'actors', 'llm'] as const).map((cat) => {
                const spent = spend.byCategory.find((r) => r.category === cat)?.spent ?? 0
                return (
                  <tr key={cat}>
                    <td>{cat}</td>
                    <td className="r num">{usd(spent)}</td>
                    <td className="r num dim">{usd(CAPS[cat])}</td>
                  </tr>
                )
              })}
              <tr>
                <td><b>total</b></td>
                <td className="r num"><b>{usd(spend.total)}</b></td>
                <td className="r num dim">{usd(CAPS.total)}</td>
              </tr>
            </tbody>
          </table>
          <p style={{ marginBottom: 0 }}>
            Cost per qualified:{' '}
            <b className="num">{spend.costPerQualified === null ? '—' : usd(spend.costPerQualified)}</b>
            <span className="dim"> · {spend.everQualified} ever qualified</span>
          </p>
        </section>

        <section className="card pad sec" style={{ marginBottom: 0 }}>
          <h3>DMs per day (last 14 days)</h3>
          {dms.length === 0 ? (
            <p className="terminal-note">
              No outbound DMs logged yet — the composer's Mark-as-DMed writes outreach_log, and this
              trend appears with the first real send.
            </p>
          ) : (
            <table className="dense">
              <thead><tr><th>Day</th><th className="r">Sent</th></tr></thead>
              <tbody>
                {dms.map((d) => (
                  <tr key={d.day}><td className="num">{d.day}</td><td className="r num">{d.sent}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card pad sec" style={{ marginBottom: 0 }}>
          <h3>Reply rate</h3>
          <p style={{ margin: 0 }}>
            <b className="num" style={{ fontSize: 22 }}>{pct(replies.rate)}</b>
            <span className="dim"> · {replies.everReplied} replied of {replies.everDmed} DMed (ever, from status_history)</span>
          </p>
          {replies.everDmed === 0 ? (
            <p className="terminal-note">Appears once the first candidate reaches DMed.</p>
          ) : null}
        </section>
      </div>
    </>
  )
}
