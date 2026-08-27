/**
 * npm run check:canon — structural integrity of ANTENNA_BLUEPRINT.md.
 *
 * The blueprint is this project's BUILD_STATE (Part XVI): it is re-read at the
 * top of every phase, so it has to READ as authored, not merely contain the
 * right characters. This guards the failure that byte-level spot checks miss —
 * a transcription that preserves every glyph but loses the blank lines, which
 * silently changes what the Markdown MEANS.
 */
import { readFileSync } from 'node:fs'

const FILE = 'ANTENNA_BLUEPRINT.md'
const EXPECTED_PARTS = [
  'PART 0', 'PART I', 'PART II', 'PART III', 'PART IV', 'PART V', 'PART VI',
  'PART VII', 'PART VIII', 'PART IX', 'PART X', 'PART XI', 'PART XII',
  'PART XIII', 'PART XIV', 'PART XV', 'PART XVI',
]

let failures = 0
let warnings = 0
const ok = (label: string, pass: boolean, detail = '') => {
  if (pass) console.log(`  ok    ${label}`)
  else { failures++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const warn = (label: string, detail: string) => { warnings++; console.log(`  warn  ${label} — ${detail}`) }

const raw = readFileSync(FILE, 'utf8')
const lines = raw.split('\n')

console.log(`canon check — ${FILE} (${lines.length} lines, ${Buffer.byteLength(raw)} bytes)`)

/** Classify each line outside code fences. */
type Kind = 'blank' | 'heading' | 'table' | 'list' | 'rule' | 'para' | 'fence'
const classify = (l: string): Kind => {
  const s = l.trim()
  if (!s) return 'blank'
  if (s.startsWith('#')) return 'heading'
  if (s.startsWith('|')) return 'table'
  if (/^([-*+]\s|\d+[.)]\s)/.test(s)) return 'list'
  if (s === '---' || /^(\*\s*){3,}$|^(-\s*){3,}$/.test(s)) return 'rule'
  return 'para'
}

const outside: { i: number; kind: Kind; text: string }[] = []
let inFence = false
let fenceCount = 0
for (const [i, l] of lines.entries()) {
  if (l.trimStart().startsWith('```')) { fenceCount++; inFence = !inFence; continue }
  if (inFence) continue
  outside.push({ i, kind: classify(l), text: l })
}

// 1. Fences balanced — an unbalanced fence swallows the rest of the document.
ok(`code fences balanced (${fenceCount} found)`, fenceCount % 2 === 0, `${fenceCount} is odd`)
ok('no unterminated fence at EOF', !inFence)

// 2. THE defect this file exists to catch. In CommonMark a `---` directly under
//    a paragraph is a setext H2 underline, not a thematic break: it silently
//    turns the paragraph above it into a heading.
const swallowed: string[] = []
for (let n = 0; n < outside.length; n++) {
  if (outside[n].kind !== 'rule') continue
  const prev = outside[n - 1]
  if (prev && prev.kind === 'para') swallowed.push(`line ${outside[n].i + 1} swallows "${prev.text.trim().slice(0, 46)}…"`)
}
ok('no `---` separator is parsed as a setext heading underline',
  swallowed.length === 0,
  `${swallowed.length} of the document's separators turn the paragraph above them into an <h2>: ${swallowed.slice(0, 3).join(' · ')}${swallowed.length > 3 ? ' …' : ''}`)

// 3. Every PART heading present and in order.
const parts = outside.filter((o) => o.kind === 'heading' && /^#\s+PART\b/.test(o.text.trim()))
  .map((o) => (o.text.trim().match(/^#\s+(PART\s+[0IVX]+)/) ?? [])[1])
ok(`all ${EXPECTED_PARTS.length} PART headings present, in order`,
  JSON.stringify(parts) === JSON.stringify(EXPECTED_PARTS),
  `found ${JSON.stringify(parts)}`)

// 4. Trailing newline — its absence is a classic truncation tell.
ok('file ends with exactly one newline', raw.endsWith('\n') && !raw.endsWith('\n\n'))

// 5. Shell-expansion damage: literal dollar amounts must have survived.
for (const needle of ['$250', '$NNN', '$1,200']) {
  ok(`literal ${needle} survived transcription (no shell expansion)`, raw.includes(needle))
}
ok('no stray backslash escapes', !/\\[$`"]/.test(raw))

// 6. Adjacent paragraphs merge into one when the blank line between them is
//    gone. Reported, not asserted: soft-wrapping is sometimes deliberate.
let merged = 0
for (let n = 1; n < outside.length; n++) {
  if (outside[n].kind === 'para' && outside[n - 1].kind === 'para') merged++
}
if (merged > 0) {
  warn('paragraphs running together', `${merged} paragraph line(s) directly follow another with no blank line, so they render as one block`)
} else {
  console.log('  ok    no paragraphs run together')
}

console.log(`\n${failures === 0 ? 'CANON OK' : `CANON DAMAGED — ${failures} failure(s)`}${warnings ? ` · ${warnings} warning(s)` : ''}`)
process.exit(failures === 0 ? 0 : 1)
