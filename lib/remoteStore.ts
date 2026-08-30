/**
 * THE REMOTE STATE STORE — the primary durability layer (ratified 2026-08-30).
 *
 * WHAT THIS REPLACES. Until now durability ran through the operator: the
 * container wrote state/snapshot.json, handed it over as a file, and a fresh
 * container could only be rebuilt from whatever had actually been downloaded
 * and kept. That worked exactly as well as a human remembering to save an
 * attachment, and this project already has the counter-example on record — the
 * actor ratification of 2026-08-29 lived in an uncommitted working tree, the
 * container was reclaimed, and the authorization was gone while the spend it
 * authorised survived in the ledger. Evidence that lives in one place does not
 * survive; the census exists because the same thing was true of the database.
 *
 * So the snapshot now goes to an Apify key-value store under the operator's
 * existing APIFY_TOKEN. Operator downloads become optional backup rather than
 * the mechanism.
 *
 * WHY NAMED, AND WHY IT IS ASSERTED. Apify expires UNNAMED stores after a
 * retention window; NAMED stores persist until deleted. A durability layer
 * built on an unnamed store is a durability layer with a silent expiry date —
 * the precise failure mode this exists to end — so the name is required, and
 * `assertNamedStore` refuses an empty or whitespace name rather than letting
 * the API mint a temporary store that would look like it was working.
 *
 * LAW 5, AND WHY THE PROCESSOR ARGUMENT HOLDS. The snapshot is person-linked:
 * handles, bios, captions, DM text. Sending it to Apify's infrastructure is
 * consistent with the already-ratified Law 3/Law 5 posture because Apify is
 * the processor that COLLECTED this data in the first place — every bio and
 * caption in the snapshot arrived through an Apify actor run. This adds no new
 * processor and no new jurisdiction. What it does add is a second copy, and
 * Law 5 answers copies with erasure: `npm run forget` purges this store, and
 * check.ts proves it does rather than trusting the claim.
 *
 * THE TOKEN travels in an Authorization header, never a URL — same discipline
 * as pipeline/providers/apify.ts, for the same reason: query strings reach
 * proxy logs, and a leaked token is a bill.
 */
import { PipelineHalt } from '@/lib/env'

const API = 'https://api.apify.com/v2'

/**
 * The store name. Constant, not configurable per-run: a durability layer you
 * can point somewhere else by typing a flag is one you can silently fail to
 * read back.
 */
export const STATE_STORE_NAME = 'antenna-state'

/** Records the store holds. Every one is person-linked except `census`. */
export const STORE_KEYS = {
  snapshot: 'snapshot',
  census: 'census',
  tombstones: 'tombstones',
  calibrationBatch: 'calibration-batch',
  calibrationPackets: 'calibration-packets',
} as const

/** Person-linked records — what a forget must purge and re-push. */
export const PERSON_LINKED_KEYS: readonly string[] = [
  STORE_KEYS.snapshot,
  STORE_KEYS.calibrationBatch,
  STORE_KEYS.calibrationPackets,
]

export type Store = { id: string; name: string }

export function requireApifyToken(): string {
  const token = process.env.APIFY_TOKEN?.trim()
  if (!token) {
    throw new PipelineHalt(
      [
        'APIFY_TOKEN is not set — the remote state store cannot be reached.',
        '',
        'The store is the primary durability layer: state/snapshot.json is gitignored',
        'by Law 5 and dies with the container, so without this token a rebuilt session',
        'has nothing to pull. Add it to .env.local (gitignored):',
        '',
        '  APIFY_TOKEN=apify_api_...',
        '',
        'Nothing was read and nothing was written.',
      ].join('\n'),
    )
  }
  return token
}

/**
 * The guard that makes this durable rather than merely working today. An
 * unnamed Apify store is garbage-collected; a named one is not.
 */
export function assertNamedStore(name: string): string {
  const trimmed = name?.trim() ?? ''
  if (!trimmed) {
    throw new PipelineHalt(
      'REFUSING TO USE AN UNNAMED KEY-VALUE STORE. Apify expires unnamed stores after its ' +
      'retention window, so state pushed to one would vanish on a schedule nobody is watching — ' +
      'which is the exact failure this store exists to end. Name the store (see STATE_STORE_NAME).',
    )
  }
  return trimmed
}

async function call(
  path: string,
  init: RequestInit & { token: string },
): Promise<Response> {
  const { token, ...rest } = init
  const res = await fetch(`${API}${path}`, {
    ...rest,
    headers: { ...(rest.headers ?? {}), Authorization: `Bearer ${token}` },
  })
  return res
}

async function haltOnFailure(res: Response, what: string): Promise<void> {
  if (res.ok) return
  const body = await res.text().catch(() => '')
  if (res.status === 401 || res.status === 403) {
    throw new PipelineHalt(
      `Apify rejected the token while ${what} (HTTP ${res.status}). Check APIFY_TOKEN — ` +
      'it should start with apify_api_ and come from apify.com → Settings → Integrations. ' +
      'Nothing was written.',
    )
  }
  throw new PipelineHalt(`Apify returned HTTP ${res.status} while ${what}: ${body.slice(0, 300)}`)
}

/**
 * Create-or-get the named store. Apify treats `POST /key-value-stores?name=X`
 * as idempotent on the name, so this is safe to call on every push and pull —
 * and calling it every time is what makes a fresh container self-sufficient.
 */
export async function resolveStore(name = STATE_STORE_NAME): Promise<Store> {
  const token = requireApifyToken()
  const safe = assertNamedStore(name)
  const res = await call(`/key-value-stores?name=${encodeURIComponent(safe)}`, {
    method: 'POST',
    token,
  })
  await haltOnFailure(res, `resolving the "${safe}" store`)
  const json = (await res.json()) as { data?: { id?: string; name?: string } }
  const id = json.data?.id
  if (!id) throw new PipelineHalt(`Apify did not return a store id for "${safe}".`)
  // Belt and braces: if the API ever hands back an unnamed store, refuse it
  // rather than write durability data into something with an expiry.
  assertNamedStore(json.data?.name ?? safe)
  return { id, name: json.data?.name ?? safe }
}

export async function putRecord(store: Store, key: string, value: unknown): Promise<number> {
  const token = requireApifyToken()
  const body = JSON.stringify(value, null, 2)
  const res = await call(`/key-value-stores/${store.id}/records/${encodeURIComponent(key)}`, {
    method: 'PUT',
    token,
    headers: { 'content-type': 'application/json' },
    body,
  })
  await haltOnFailure(res, `writing "${key}"`)
  return Buffer.byteLength(body)
}

export async function getRecord<T = unknown>(store: Store, key: string): Promise<T | null> {
  const token = requireApifyToken()
  const res = await call(`/key-value-stores/${store.id}/records/${encodeURIComponent(key)}`, {
    method: 'GET',
    token,
  })
  if (res.status === 404) return null
  await haltOnFailure(res, `reading "${key}"`)
  return (await res.json()) as T
}

export async function deleteRecord(store: Store, key: string): Promise<void> {
  const token = requireApifyToken()
  const res = await call(`/key-value-stores/${store.id}/records/${encodeURIComponent(key)}`, {
    method: 'DELETE',
    token,
  })
  // A key that is already gone is the desired end state, not an error.
  if (res.status === 404) return
  await haltOnFailure(res, `deleting "${key}"`)
}

export async function listKeys(store: Store): Promise<string[]> {
  const token = requireApifyToken()
  const res = await call(`/key-value-stores/${store.id}/keys?limit=1000`, { method: 'GET', token })
  await haltOnFailure(res, 'listing keys')
  const json = (await res.json()) as { data?: { items?: { key: string }[] } }
  return (json.data?.items ?? []).map((i) => i.key)
}

/**
 * Purge every person-linked record. Called by `npm run forget`, which cannot
 * honour Law 5 by rebuilding only the local database: the store holds a
 * snapshot containing the person, and a copy you did not erase is a copy.
 *
 * The census survives deliberately — it is person-free by construction (check
 * proves that) and it is the tripwire that makes the next data loss loud.
 */
/**
 * The transport, injectable purely so the erasure can be PROVEN. Law 5 is the
 * one guarantee that must not rest on reading the code and agreeing with it,
 * and a purge that only ever runs against the live network is a purge the
 * check suite cannot test. check.ts drives this with an in-memory fake.
 */
export type StoreIo = {
  listKeys: (store: Store) => Promise<string[]>
  deleteRecord: (store: Store, key: string) => Promise<void>
}

const liveIo: StoreIo = { listKeys, deleteRecord }

export async function purgePersonLinked(store: Store, io: StoreIo = liveIo): Promise<string[]> {
  const present = new Set(await io.listKeys(store))
  const purged: string[] = []
  for (const key of PERSON_LINKED_KEYS) {
    if (!present.has(key)) continue
    await io.deleteRecord(store, key)
    purged.push(key)
  }
  return purged
}

/**
 * Every key this store can hold that carries a person, derived rather than
 * hand-listed. If a future record is added to STORE_KEYS and is not one of the
 * two person-free ones, it lands here automatically and the check suite fails
 * until PERSON_LINKED_KEYS covers it — so a new person-linked record cannot be
 * added without also being made erasable.
 */
export const PERSON_FREE_KEYS: readonly string[] = [STORE_KEYS.census, STORE_KEYS.tombstones]
export function personLinkedKeysFrom(all: readonly string[]): string[] {
  return all.filter((k) => !PERSON_FREE_KEYS.includes(k))
}
