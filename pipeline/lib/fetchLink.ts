/**
 * PART 4a — the link-page fetcher: polite plain fetch, 1 req/sec, 10s
 * timeout. If the body yields <500 chars of text (a JS shell), status is
 * 'failed' and the pipeline continues — the candidate is still scoreable from
 * IG data alone at lower confidence. Never block on it.
 *
 * LAW 3 GUARD: this fetcher REFUSES Instagram hosts. No direct scraping of
 * Instagram from any infrastructure we own — IG-side data comes only from
 * commercial actors (their infra carries the collection risk). The guard is
 * a hard throw, not a skip, so a miswired adapter fails loudly.
 */
import { PipelineHalt } from '@/lib/env'

const FORBIDDEN_HOSTS = [
  'instagram.com', 'www.instagram.com', 'm.instagram.com',
  'instagr.am', 'www.instagr.am', 'cdninstagram.com',
]

/** Law 3, as a pure predicate — asserted directly by npm run check. */
export function isFetchableUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (!/^https?:$/.test(parsed.protocol)) return false
  const host = parsed.hostname.toLowerCase()
  return !FORBIDDEN_HOSTS.some((f) => host === f || host.endsWith(`.${f}`))
}

export const JS_SHELL_FLOOR = 500

/** Crude but sufficient: scripts/styles/tags out, entities in, whitespace folded. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

let lastFetchAt = 0
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export type FetchLinkResult = { status: 'ok' | 'failed'; text: string }

/**
 * intervalMs/timeoutMs are parameters so the unit test can run in
 * milliseconds; production callers use the canon defaults (1 req/s, 10s).
 */
export async function fetchLink(
  url: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<FetchLinkResult> {
  const { timeoutMs = 10_000, intervalMs = 1_000 } = opts

  if (!isFetchableUrl(url)) {
    throw new PipelineHalt(
      `fetchLink refused ${url} — Instagram hosts are never fetched from our own ` +
      `infrastructure (Law 3). IG-side data comes only from commercial actors.`,
    )
  }

  // Polite: 1 request per second, globally.
  const wait = lastFetchAt + intervalMs - Date.now()
  if (wait > 0) await sleep(wait)
  lastFetchAt = Date.now()

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'user-agent': 'antenna-link-fetch/1.0 (+internal prospecting; polite: 1 req/s)' },
      })
      if (!res.ok) return { status: 'failed', text: '' }
      const text = htmlToText(await res.text())
      // <500 chars of text = a JS shell (Part 4a): failed, and we continue.
      return text.length < JS_SHELL_FLOOR ? { status: 'failed', text: '' } : { status: 'ok', text }
    } finally {
      clearTimeout(timer)
    }
  } catch {
    // Timeouts and network errors never block the run (Part 4a).
    return { status: 'failed', text: '' }
  }
}
