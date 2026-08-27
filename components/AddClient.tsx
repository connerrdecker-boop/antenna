'use client'
import { useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { submitAdd } from '@/app/actions'
import type { AddOutcome } from '@/db/repo'
import { STATUS_LABELS } from '@/lib/status'

export function AddClient() {
  const [raw, setRaw] = useState('')
  const [csv, setCsv] = useState('')
  const [csvName, setCsvName] = useState<string | null>(null)
  const [results, setResults] = useState<AddOutcome[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const fileRef = useRef<HTMLInputElement>(null)

  const submit = () => {
    setError(null)
    startTransition(async () => {
      const res = await submitAdd(raw, csv)
      if (!res.ok) { setError(res.error); return }
      setResults(res.data)
      setRaw(''); setCsv(''); setCsvName(null)
      if (fileRef.current) fileRef.current.value = ''
    })
  }

  const counts = results
    ? {
        added: results.filter((r) => r.kind === 'added').length,
        existing: results.filter((r) => r.kind === 'existing').length,
        invalid: results.filter((r) => r.kind === 'invalid').length,
      }
    : null

  return (
    <div className="addgrid">
      <div className="card pad">
        <section className="sec">
          <h3>Paste handles or URLs</h3>
          <textarea
            rows={10}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={'@coachjane\nhttps://www.instagram.com/liftswithmarcus/\nsofla.strength.co'}
          />
          <p className="terminal-note">
            One per line (or comma-separated). Mix bare handles and URLs freely. A line of prose is
            rejected whole rather than chopped into fake handles.
          </p>
        </section>

        <section className="sec">
          <h3>…or upload a CSV</h3>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (!f) { setCsv(''); setCsvName(null); return }
              setCsv(await f.text())
              setCsvName(`${f.name} · ${(f.size / 1024).toFixed(1)} KB`)
            }}
          />
          {csvName ? <p className="terminal-note">{csvName} — first column is read as the handle.</p> : null}
        </section>

        {error ? <div className="err">{error}</div> : null}
        <button type="button" className="btn primary" disabled={pending || (!raw.trim() && !csv.trim())} onClick={submit}>
          {pending ? 'Adding…' : 'Add candidates'}
        </button>
      </div>

      <div className="card pad">
        <section className="sec" style={{ marginBottom: 0 }}>
          <h3>Result</h3>
          {!results ? (
            <p className="terminal-note">
              Nothing added yet. Dedupe is on <code>handle</code> — an existing candidate is surfaced
              here, never duplicated and never overwritten.
            </p>
          ) : (
            <>
              <div className={counts && counts.added > 0 ? 'ok' : 'warnbox'}>
                <b className="num">{counts?.added}</b> added ·{' '}
                <b className="num">{counts?.existing}</b> already known ·{' '}
                <b className="num">{counts?.invalid}</b> unusable
                {counts && counts.added > 0 ? <> · <Link href="/pipeline?status=sourced">see them in the pipeline →</Link></> : null}
              </div>
              <div className="results">
                {results.map((r, i) => (
                  <div key={i} className="results-row">
                    <span className={`tag ${r.kind}`}>{r.kind}</span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      {r.kind === 'invalid' ? (
                        <>
                          <code>{r.input}</code> <span className="dim">— {r.reason}</span>
                        </>
                      ) : (
                        <>
                          <b>{r.handle}</b>
                          {r.kind === 'existing' ? (
                            <span className="dim"> — already {STATUS_LABELS[r.status]}</span>
                          ) : null}
                          {r.input.toLowerCase() !== r.handle ? <span className="dim"> ← {r.input}</span> : null}
                        </>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
