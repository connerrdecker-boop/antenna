/**
 * TOMBSTONES — Law 5's "trivial delete-on-request", made to stick.
 *
 * Deleting a coach's row is only half of honouring an erasure request. The
 * other half is not collecting them again the next time harvest runs the same
 * query — which it would, because they are still a real coach who still
 * matches. So a forget writes a tombstone, and every door that creates a
 * candidate consults it.
 *
 * WHAT A TOMBSTONE CONTAINS, AND WHAT THAT IS WORTH SAYING PLAINLY: a
 * SHA-256 fingerprint of the handle, and a date. No handle, no bio, no reason.
 * Being able to answer "is THIS handle forgotten?" requires a deterministic
 * function of the handle, so the fingerprint is by construction checkable
 * against a guess — an Instagram handle is low-entropy, and someone holding
 * both this file and a list of handles could confirm a match. It is
 * pseudonymous, not anonymous, and the file is committed on that
 * understanding: the alternative is either re-harvesting people who asked to
 * be left alone, or storing their handles in plaintext forever. This is the
 * least-worst of the three, and calling it "anonymised" would be the kind of
 * claim the Ninth Law exists to forbid.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

export const TOMBSTONE_PATH = 'state/tombstones.json'
export const TOMBSTONE_SCHEMA = 1

export type Tombstone = { fp: string; at: string }
export type TombstoneFile = { schema: number; forgotten: Tombstone[] }

/** One-way, deterministic, truncated. See the header on what this does not buy. */
export function handleFingerprint(handle: string): string {
  return createHash('sha256').update(handle.trim().toLowerCase()).digest('hex').slice(0, 16)
}

export function readTombstones(path = TOMBSTONE_PATH): TombstoneFile {
  if (!existsSync(path)) return { schema: TOMBSTONE_SCHEMA, forgotten: [] }
  return JSON.parse(readFileSync(path, 'utf8')) as TombstoneFile
}

let cache: { path: string; set: Set<string> } | null = null

/** The predicate every candidate-creating door calls. Cached per path. */
export function isForgotten(handle: string, path = TOMBSTONE_PATH): boolean {
  if (!cache || cache.path !== path) {
    cache = { path, set: new Set(readTombstones(path).forgotten.map((t) => t.fp)) }
  }
  return cache.set.has(handleFingerprint(handle))
}

/** Drops the memoized set — for tests and for the forget CLI's own re-read. */
export function invalidateTombstoneCache(): void {
  cache = null
}

export function addTombstone(handle: string, at: string, path = TOMBSTONE_PATH): TombstoneFile {
  const file = readTombstones(path)
  const fp = handleFingerprint(handle)
  if (!file.forgotten.some((t) => t.fp === fp)) file.forgotten.push({ fp, at })
  file.forgotten.sort((a, b) => a.fp.localeCompare(b.fp))
  mkdirSync('state', { recursive: true })
  writeFileSync(path, JSON.stringify({ schema: TOMBSTONE_SCHEMA, forgotten: file.forgotten }, null, 2) + '\n')
  invalidateTombstoneCache()
  return file
}
