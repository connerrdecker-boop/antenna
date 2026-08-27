/**
 * PART V — ENRICH.
 *
 * The gate: enrich runs only on candidates with pre_score >= PRESCORE_THRESHOLD.
 * One documented exception (flagged for ratification): a candidate with no bio
 * at all — every manual add (Part 4d: "/add … runs the full enrich/score
 * pipe") — cannot be pre-scored until a profile packet exists, so it gets a
 * bootstrap enrichment first. The gate's purpose is to keep paid enrichment
 * off harvest noise; harvest-sourced rows always carry a bio and take the
 * gate as written.
 *
 * Every enrichment writes an observation snapshot (Law 9), no exceptions.
 */
import { PRESCORE_THRESHOLD } from '@/config/limits'
import { getSqlite } from '@/db/connection'
import { recordObservation } from '@/db/observations'
import { linkDomainOf } from '@/lib/handle'
import type { ProfilePacket, ProfileProvider } from './types'

export type EnrichOutcome = 'enriched' | 'no_data' | 'gated'

type CandidateRow = {
  id: number
  handle: string
  bio: string | null
  pre_score: number | null
  name: string | null
  link_domain?: string | null
}

/**
 * The Part V gate, bootstrap exception included. A3 refinement: once a
 * pre-score EXISTS it always rules — a serper-sourced row (bio null,
 * link_domain set) that pre-scored below threshold must never be enriched via
 * the bootstrap door. Bootstrap applies only to rows with nothing to
 * pre-score on at all: no bio AND no link_domain (i.e. manual adds).
 */
export function enrichAllowed(c: {
  bio: string | null
  pre_score: number | null
  link_domain?: string | null
}): boolean {
  if (c.pre_score !== null) return c.pre_score >= PRESCORE_THRESHOLD
  const hasBio = !!c.bio?.trim()
  const hasLink = !!c.link_domain?.trim()
  return !hasBio && !hasLink // bootstrap: nothing for the pre-filter to read yet
}

export async function enrichCandidate(
  candidate: CandidateRow,
  provider: ProfileProvider,
): Promise<EnrichOutcome> {
  if (!enrichAllowed({ bio: candidate.bio, pre_score: candidate.pre_score, link_domain: candidate.link_domain })) {
    return 'gated'
  }

  const packet = await provider.fetchProfile(candidate.handle)
  if (!packet) return 'no_data'

  applyPacket(candidate.id, candidate, packet, provider.name)
  return 'enriched'
}

function applyPacket(
  id: number,
  candidate: CandidateRow,
  packet: ProfilePacket,
  providerName: string,
): void {
  const sqlite = getSqlite()
  const now = new Date().toISOString()

  const linkUrl = packet.linkUrl ?? null
  const hasLinkText = !!packet.linkContents && packet.linkContents.trim().length > 0
  // Packet text is provider-supplied (a fixture, or a packet the operator
  // curated by hand) — it is stored as-is. Part 4a's <500-char JS-shell rule
  // diagnoses LIVE fetches and belongs to lib/fetchLink.ts when A3 wires it;
  // applying it here would throw away genuine short link pages. A link with no
  // text yet is 'skipped' (not fetched), never 'failed'.
  const linkFetchStatus = linkUrl ? (hasLinkText ? 'ok' : 'skipped') : 'skipped'

  const run = sqlite.transaction(() => {
    sqlite
      .prepare(
        `UPDATE candidates SET
           name = COALESCE(?, name), bio = ?, follower_count = ?,
           link_url = COALESCE(?, link_url), link_domain = COALESCE(?, link_domain),
           link_contents = ?, link_fetch_status = ?,
           last_enriched = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        packet.name ?? candidate.name, packet.bio, packet.followerCount,
        linkUrl, linkDomainOf(linkUrl),
        hasLinkText ? packet.linkContents : null, linkFetchStatus,
        now, now, id,
      )

    // Law 9: every enrichment writes a snapshot. Append-only, forever.
    recordObservation({
      handle: candidate.handle,
      observedAt: now,
      followerCount: packet.followerCount,
      posts30d: packet.posts30d ?? null,
      formatMix: packet.formatMix ?? null,
      engagementProxy: packet.engagementProxy ?? null,
      source: `enrich:${providerName}`,
    })
  })
  run()
}
