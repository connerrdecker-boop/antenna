/**
 * Part 4a extraction — pure functions over a hit's page text:
 * IG handles (instagram.com/<user> links, @handle text), price patterns
 * ($NNN), platform tells. All unit-probed by npm run check against fixed
 * inputs, so extraction drift is visible.
 */
import { normalizeHandle } from '@/lib/handle'

/**
 * All valid IG handles found in the text, instagram.com links first (they are
 * deliberate self-identification; bare @mentions are noisier), de-duplicated,
 * document order preserved within each class.
 */
export function extractHandles(text: string): string[] {
  const found: string[] = []
  const push = (raw: string) => {
    const handle = normalizeHandle(raw)
    if (handle && !found.includes(handle)) found.push(handle)
  }
  for (const m of text.matchAll(/instagram\.com\/([A-Za-z0-9._]{1,30})/gi)) {
    push(`https://instagram.com/${m[1]}`)
  }
  for (const m of text.matchAll(/@([A-Za-z0-9._]{2,30})/g)) {
    // Skip email addresses: "coach@gmail.com" is not a handle.
    const at = m.index ?? 0
    const before = text[at - 1] ?? ' '
    if (/[A-Za-z0-9.]/.test(before)) continue
    push(m[1])
  }
  return found
}

/** Price patterns: $NNN, $N,NNN, with optional /mo-style suffixes. */
export function extractPrices(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/\$\d{1,3}(?:,\d{3})*(?:\.\d{2})?(?:\s*\/\s*(?:mo|month|wk|week|session|yr|year))?/gi)) {
    const price = m[0].replace(/\s+/g, ' ').trim()
    if (!out.includes(price)) out.push(price)
  }
  return out
}

/** The duct-tape stack, spotted in a URL or page text (Part 4a: platform tells). */
const TELLS: ReadonlyArray<readonly [signal: string, pattern: RegExp]> = [
  ['stan_store', /stan\.store/i],
  ['linktree', /linktr\.ee/i],
  ['beacons', /beacons\.ai/i],
  ['calendly', /calendly\.com|calendly/i],
  ['gumroad', /gumroad/i],
  ['shopify', /shopify|myshopify\.com/i],
  ['venmo_mention', /venmo/i],
  ['klarna', /klarna/i],
  ['typeform', /typeform/i],
  ['google_forms', /docs\.google\.com\/forms|google forms/i],
  ['tiktok_presence', /tiktok\.com|tiktok/i],
]

export function extractPlatformTells(urlAndText: string): string[] {
  return TELLS.filter(([, re]) => re.test(urlAndText)).map(([signal]) => signal)
}
