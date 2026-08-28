/**
 * Actor item -> ProfilePacket.
 *
 * This is the part of the actor integration most likely to rot: actor output
 * schemas change between generations, and a mapper that silently returns zeros
 * when a field is renamed would poison every score downstream with confident
 * nonsense. So every read goes through `pick`, which tries known aliases and
 * RECORDS which one hit. `mapActorItem` returns that report alongside the
 * packet, and the smoke test prints it — the operator sees "followers: read
 * from followersCount" or "followers: NOT FOUND", never a silent 0.
 *
 * Absent means null, never zero. A missing follower count is unknown; zero is
 * a claim about the world we have no evidence for.
 */
import type { ProfilePacket } from '../types'

export type FieldReport = { field: string; via: string | null }
export type MapReport = { fields: FieldReport[]; missing: string[] }

type Item = Record<string, unknown>

function pick(item: Item, aliases: string[]): { value: unknown; via: string | null } {
  for (const a of aliases) {
    const value = a.includes('.')
      ? a.split('.').reduce<unknown>((acc, k) => (acc && typeof acc === 'object' ? (acc as Item)[k] : undefined), item)
      : item[a]
    if (value !== undefined && value !== null && value !== '') return { value, via: a }
  }
  return { value: undefined, via: null }
}

const asString = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const asNumber = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}
const asArray = (v: unknown): Item[] => (Array.isArray(v) ? (v as Item[]) : [])

/** Apify post types, normalized to the format-mix vocabulary. */
function postFormat(post: Item): string {
  const product = asString(post.productType)?.toLowerCase() ?? ''
  const type = (asString(post.type) ?? asString(post.__typename) ?? '').toLowerCase()
  if (product.includes('clips') || type.includes('reel')) return 'reel'
  if (type.includes('sidecar') || type.includes('carousel')) return 'carousel'
  if (type.includes('video')) return 'video'
  if (type.includes('image') || type.includes('photo')) return 'image'
  return 'other'
}

function postTimestamp(post: Item): number | null {
  const raw = pick(post, ['timestamp', 'takenAt', 'taken_at_timestamp', 'takenAtTimestamp']).value
  if (typeof raw === 'number') return raw > 1e11 ? raw : raw * 1000 // seconds vs millis
  const s = asString(raw)
  if (!s) return null
  const t = Date.parse(s)
  return Number.isFinite(t) ? t : null
}

/**
 * `null` packet means the item is not a profile we can use (no handle at all).
 * A private profile DOES map — its public surface is real — and carries
 * isPrivate so the pipeline can honour "a private account is an honest X, no
 * paid score" without pretending the data is missing.
 */
export function mapActorItem(item: Item, now = Date.now()): { packet: ProfilePacket | null; report: MapReport } {
  const fields: FieldReport[] = []
  const track = <T>(field: string, r: { value: unknown; via: string | null }, cast: (v: unknown) => T): T => {
    fields.push({ field, via: r.via })
    return cast(r.value)
  }

  const handle = track('handle', pick(item, ['username', 'ownerUsername', 'handle', 'userName']), asString)
  if (!handle) return { packet: null, report: { fields, missing: ['handle'] } }

  const name = track('name', pick(item, ['fullName', 'ownerFullName', 'name', 'full_name']), asString)
  const bio = track('bio', pick(item, ['biography', 'bio', 'description']), asString)
  const followerCount = track(
    'followerCount',
    pick(item, ['followersCount', 'followers', 'followerCount', 'edge_followed_by.count']),
    asNumber,
  )
  const isPrivate = track('isPrivate', pick(item, ['private', 'isPrivate', 'is_private']), (v) =>
    typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : null,
  )
  const linkUrl = track(
    'linkUrl',
    pick(item, ['externalUrl', 'external_url', 'website', 'bioLinks.0.url', 'externalUrls.0.url']),
    asString,
  )
  const posts = track('latestPosts', pick(item, ['latestPosts', 'posts', 'topPosts', 'edge_owner_to_timeline_media.edges']), asArray)

  const captions = posts.map((p) => asString(p.caption) ?? asString(p.text) ?? '').filter((c) => c.trim().length > 0)

  // posts30d only counts when the actor gave us timestamps to count WITH.
  // Deriving "0 posts in 30 days" from undated posts would invent a dead
  // account out of a schema gap, and alive_30d is a hard gate in Part 6.2.
  const stamped = posts.map(postTimestamp).filter((t): t is number => t !== null)
  const cutoff = now - 30 * 24 * 60 * 60 * 1000
  const posts30d = stamped.length ? stamped.filter((t) => t >= cutoff).length : null

  let formatMix: Record<string, number> | null = null
  if (posts.length) {
    const counts: Record<string, number> = {}
    for (const p of posts) counts[postFormat(p)] = (counts[postFormat(p)] ?? 0) + 1
    formatMix = Object.fromEntries(
      Object.entries(counts).map(([k, n]) => [k, Number((n / posts.length).toFixed(3))]),
    )
  }

  // Engagement proxy: mean (likes + comments) per post over followers. Needs
  // both a follower count and at least one post carrying counts.
  const engagements = posts
    .map((p) => {
      const l = asNumber(pick(p, ['likesCount', 'likes', 'edge_liked_by.count']).value)
      const c = asNumber(pick(p, ['commentsCount', 'comments', 'edge_media_to_comment.count']).value)
      return l === null && c === null ? null : (l ?? 0) + (c ?? 0)
    })
    .filter((n): n is number => n !== null)
  const engagementProxy =
    followerCount && followerCount > 0 && engagements.length
      ? Number((engagements.reduce((a, b) => a + b, 0) / engagements.length / followerCount).toFixed(5))
      : null

  const tags = [
    ...new Set(posts.map((p) => asString(p.locationName) ?? asString(p.location_name)).filter((s): s is string => !!s)),
  ]

  const missing = fields.filter((f) => f.via === null).map((f) => f.field)

  return {
    packet: {
      handle: handle.toLowerCase().replace(/^@+/, ''),
      name,
      bio: bio ?? '',
      followerCount,
      captions: captions.length ? captions : undefined,
      posts30d,
      formatMix,
      engagementProxy,
      tags: tags.length ? tags : undefined,
      linkUrl,
      // The actor gives us the link URL, not the link PAGE. Fetching that page
      // is lib/fetchLink.ts's job, kept separate so the <500-char JS-shell rule
      // applies to live fetches only (Part 4a, ratified A3).
      linkContents: null,
      isPrivate,
    },
    report: { fields, missing },
  }
}
