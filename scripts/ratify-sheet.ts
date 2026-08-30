/**
 * `npm run ratify:sheet` — the offline stand-in for /ratify.
 *
 * The app's queue is the real ratification path and this does NOT replace it:
 * decisions still go back through applyRatifyDecision(), which writes the
 * ratifications row, transitions the status through the Part 8.2 graph, and
 * fires the write-through. This only renders what the operator would see on
 * screen, in the SAME order the queue serves it (tier, then score desc, then
 * handle), for a session where the browser cannot reach the container.
 *
 * Person-linked by construction — handles, bios, rubric evidence, hook drafts.
 * It writes under state/calibration/, which is gitignored, and it is handed to
 * the operator directly rather than published anywhere.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { getSqlite } from '@/db/connection'
import { loadEnvLocal } from '@/lib/env'
import { listRatifyQueue } from '@/db/repo'

const OUT = 'state/calibration/ratify-sheet.md'

const asArray = (v: unknown): string[] => {
  if (!v) return []
  try {
    const p = typeof v === 'string' ? JSON.parse(v) : v
    return Array.isArray(p) ? p.map(String) : []
  } catch { return [] }
}

function main(): void {
  loadEnvLocal()
  const sqlite = getSqlite()

  // The calibration batch, identified by the marker the run wrote to `notes`.
  const calibration = new Set(
    (sqlite
      .prepare("SELECT handle FROM candidates WHERE notes LIKE '%score_context=calibration%'")
      .all() as { handle: string }[]).map((r) => r.handle),
  )

  const prescore = new Map(
    (sqlite
      .prepare(
        `SELECT c.handle, c.pre_score,
                (SELECT MIN(s.at) FROM spend s WHERE s.run_ref = 'prescore:' || c.handle) AS at
           FROM candidates c`,
      )
      .all() as { handle: string; pre_score: number | null; at: string | null }[])
      .map((r) => [r.handle, r]),
  )

  const queue = listRatifyQueue().filter((c) => calibration.has(c.handle))

  const L: string[] = []
  L.push('# RATIFY SHEET — A2 calibration batch')
  L.push('')
  L.push(`Generated ${new Date().toISOString()} · ${queue.length} candidates · queue order (tier, score desc, handle).`)
  L.push('')
  L.push('Reply with one line per candidate: `<n> <y|n|b|f>` — and for `n`, a reject reason.')
  L.push('')
  L.push('| | verdict | meaning |')
  L.push('|---|---|---|')
  L.push('| `y` | approve | sourced → qualified. DM-able. |')
  L.push('| `n` | reject | needs a reason. |')
  L.push('| `b` | bank | keep, do not work now. |')
  L.push('| `f` | flag | park it, decide later. |')
  L.push('')
  L.push('Every verdict is entered through the real ratification code path')
  L.push('(`applyRatifyDecision`), so the Part 8.2 graph, the Law 10 gate and the')
  L.push('write-through all apply exactly as they would in the browser.')
  L.push('')
  L.push('---')
  L.push('')

  queue.forEach((c, i) => {
    const pre = prescore.get(c.handle)
    const preScore = pre?.pre_score ?? null
    const wouldKill = preScore !== null && preScore < 40
    const evidence = asArray(c.evidence)
    const kills = evidence.filter((e) => e.startsWith('PRESCORE kill: '))
    const gates = evidence.filter((e) => e.startsWith('GATE '))
    const dims = evidence.filter((e) => e.startsWith('DIM '))
    const pens = evidence.filter((e) => e.startsWith('PENALTY '))
    const stack = asArray(c.stackSignals)

    L.push(`## ${i + 1}. @${c.handle} — **${c.tier} ${c.score}**`)
    L.push('')
    L.push(`- **name** ${c.name ?? '—'}`)
    L.push(`- **followers** ${c.followerCount === null ? 'unknown' : c.followerCount.toLocaleString()}`)
    L.push(`- **metro** ${c.metro ?? 'unknown'}${c.metroConfidence !== null ? ` (confidence ${c.metroConfidence})` : ''}`)
    L.push(`- **link** ${c.linkUrl ?? c.linkDomain ?? '—'}`)
    L.push(`- **pre-score** ${preScore ?? '—'} → **${wouldKill ? 'WOULD HAVE BEEN KILLED (gate bypassed)' : 'would have passed'}**`)
    if (kills.length) {
      L.push('- **pre-score kill reasons**')
      for (const k of kills) L.push(`  - ${k.replace('PRESCORE kill: ', '')}`)
    }
    L.push('')
    if (c.bio) { L.push('**bio**'); L.push(''); L.push('> ' + String(c.bio).replace(/\n/g, '\n> ')); L.push('') }

    if (gates.length) {
      L.push('**gates**')
      L.push('')
      for (const g of gates) L.push(`- ${g.replace(/^GATE /, '')}`)
      L.push('')
    }
    if (dims.length) {
      L.push('**rubric**')
      L.push('')
      for (const d of dims) L.push(`- ${d.replace(/^DIM /, '')}`)
      L.push('')
    }
    if (pens.length) {
      for (const p of pens) L.push(`- ${p}`)
      L.push('')
    }
    if (stack.length) { L.push(`**stack signals** ${stack.join(', ')}`); L.push('') }
    if (c.hookDraft) { L.push('**hook draft** (a note to you, not message copy)'); L.push(''); L.push(`> ${c.hookDraft}`); L.push('') }
    L.push(`**${i + 1}. @${c.handle} → your verdict: \`y\` / \`n\` + reason / \`b\` / \`f\`**`)
    L.push('')
    L.push('---')
    L.push('')
  })

  mkdirSync('state/calibration', { recursive: true })
  writeFileSync(OUT, L.join('\n'))
  console.log(`\nratify sheet written: ${OUT} (${queue.length} candidates, ${L.length} lines)\n`)
}

main()
