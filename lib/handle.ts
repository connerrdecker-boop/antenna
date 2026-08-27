/**
 * `handle` is THE dedupe key (Part III): unique, lowercased, bare.
 * Everything that can name a candidate funnels through here.
 */

const IG_HOSTS = new Set([
  'instagram.com', 'www.instagram.com', 'm.instagram.com', 'instagr.am', 'www.instagr.am',
])

/** Instagram allows a-z 0-9 . _ and is 1-30 chars. */
const HANDLE_RE = /^[a-z0-9._]{1,30}$/

/** Non-profile Instagram paths that must never be mistaken for a handle. */
const RESERVED = new Set([
  'p', 'reel', 'reels', 'tv', 'stories', 'explore', 'accounts', 'direct',
  'about', 'developer', 'legal', 'privacy', 'terms', 's',
])

/**
 * Accepts `foo`, `@foo`, `instagram.com/foo`, `https://www.instagram.com/foo/?hl=en`.
 * Returns null when the input is not a usable Instagram profile handle.
 */
export function normalizeHandle(input: string): string | null {
  let s = (input ?? '').trim()
  if (!s) return null

  if (s.includes('/') || /^https?:/i.test(s)) {
    let url: URL | null = null
    try {
      url = new URL(/^https?:/i.test(s) ? s : `https://${s}`)
    } catch {
      return null
    }
    if (!IG_HOSTS.has(url.hostname.toLowerCase())) return null
    const first = url.pathname.split('/').filter(Boolean)[0]
    if (!first) return null
    s = first
  }

  s = s.replace(/^@+/, '').trim().toLowerCase()
  // Strip a trailing dot, which link text often carries at end of a sentence.
  s = s.replace(/\.+$/, '')
  if (!HANDLE_RE.test(s)) return null
  if (RESERVED.has(s)) return null
  return s
}

export function igUrlFor(handle: string): string {
  return `https://www.instagram.com/${handle}/`
}

/**
 * Secondary dedupe key (Part III): normalized link_url. Two candidates sharing a
 * link page get FLAGGED for manual merge, never auto-merged.
 */
export function normalizeLinkUrl(input: string | null | undefined): string | null {
  if (!input) return null
  let url: URL
  try {
    url = new URL(/^https?:/i.test(input) ? input : `https://${input.trim()}`)
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  const path = url.pathname.replace(/\/+$/, '').toLowerCase()
  return `${host}${path}` || null
}

export function linkDomainOf(input: string | null | undefined): string | null {
  const norm = normalizeLinkUrl(input)
  return norm ? norm.split('/')[0] : null
}
