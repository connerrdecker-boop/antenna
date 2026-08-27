/**
 * The manual/fixture profile provider — the pipeline runs end-to-end without
 * any external account.
 *
 * Packet sources, in order:
 *   1. pipeline/fixtures/profiles.json — committed, FAKE profiles for tests.
 *   2. profiles/*.json — gitignored drop-in for REAL packets the operator
 *      assembles by hand (the calibration path until the actor lands in A3).
 *      Either one file per handle (profiles/<handle>.json holding a packet) or
 *      any .json holding an array of packets.
 *
 * Law 5 note: real-person packets carry public business signals only, and the
 * profiles/ directory is gitignored so they never reach the repo.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ProfilePacket, ProfileProvider } from '../types'

const FIXTURES = 'pipeline/fixtures/profiles.json'
const MANUAL_DIR = 'profiles'

function coerce(raw: unknown): ProfilePacket | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.handle !== 'string' || typeof r.bio !== 'string') return null
  if (typeof r.follower_count !== 'number' && typeof r.followerCount !== 'number') return null
  return {
    handle: r.handle.toLowerCase(),
    name: (r.name as string) ?? null,
    bio: r.bio,
    followerCount: (r.followerCount ?? r.follower_count) as number,
    captions: Array.isArray(r.captions) ? r.captions.map(String) : [],
    posts30d: (r.posts30d ?? r.posts_30d ?? null) as number | null,
    formatMix: (r.formatMix ?? r.format_mix ?? null) as Record<string, number> | null,
    engagementProxy: (r.engagementProxy ?? r.engagement_proxy ?? null) as number | null,
    tags: Array.isArray(r.tags) ? r.tags.map(String) : [],
    linkUrl: (r.linkUrl ?? r.link_url ?? null) as string | null,
    linkContents: (r.linkContents ?? r.link_contents ?? null) as string | null,
  }
}

function loadAll(): Map<string, ProfilePacket> {
  const packets = new Map<string, ProfilePacket>()
  const ingest = (raw: unknown) => {
    for (const item of Array.isArray(raw) ? raw : [raw]) {
      const packet = coerce(item)
      if (packet) packets.set(packet.handle, packet)
    }
  }
  if (existsSync(FIXTURES)) {
    ingest(JSON.parse(readFileSync(FIXTURES, 'utf8')))
  }
  if (existsSync(MANUAL_DIR)) {
    for (const file of readdirSync(MANUAL_DIR).filter((f) => f.endsWith('.json'))) {
      try {
        ingest(JSON.parse(readFileSync(join(MANUAL_DIR, file), 'utf8')))
      } catch {
        console.warn(`  provider:fixture — ${MANUAL_DIR}/${file} is not valid JSON, skipped`)
      }
    }
  }
  return packets
}

export function fixtureProvider(): ProfileProvider {
  let cache: Map<string, ProfilePacket> | null = null
  return {
    name: 'fixture',
    async fetchProfile(handle: string): Promise<ProfilePacket | null> {
      cache ??= loadAll()
      return cache.get(handle.toLowerCase()) ?? null
    },
  }
}
