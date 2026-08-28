/**
 * PART 4b — the real Apify actor client.
 *
 * Law 3 holds here by construction: we call a COMMERCIAL actor's HTTP API.
 * Nothing in this file touches instagram.com, and `assertNoForbiddenKeys`
 * refuses to send an input carrying cookies, a session id or a password — the
 * law is a predicate, not an intention.
 *
 * Cost discipline (Law 6 / Part X): the caller gates on ensureBudget() with an
 * ESTIMATE before we start a run, `maxTotalChargeUsd` bounds the run itself,
 * and the amount written to `spend` afterwards is the ACTUAL figure Apify
 * reports on the finished run (`usageTotalUsd`) — a receipt, not a guess.
 *
 * The token travels in an Authorization header, never in a URL: query strings
 * end up in proxy logs and error messages, and a leaked token is a bill.
 */
import { ACTOR_RUN_BOUNDS, FORBIDDEN_INPUT_KEYS } from '@/config/actors'
import { PipelineHalt } from '@/lib/env'

const API = 'https://api.apify.com/v2'

const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT', 'TIMING-OUT'])

export type ActorRunResult = {
  runId: string
  status: string
  /** Apify's own figure for what the run cost. The number we bank. */
  usageUsd: number
  items: Record<string, unknown>[]
  elapsedMs: number
}

/** Law 3, enforced: a credentialed input never leaves this process. */
export function assertNoForbiddenKeys(input: Record<string, unknown>, path = 'input'): void {
  for (const [k, v] of Object.entries(input)) {
    if (FORBIDDEN_INPUT_KEYS.some((f) => f.toLowerCase() === k.toLowerCase())) {
      throw new PipelineHalt(
        `LAW 3 REFUSAL: actor input carries "${path}.${k}". Antenna never sends session cookies, ` +
        'logins or passwords to any service — that is the law Instar\'s Meta API goodwill depends on. ' +
        'Nothing was sent and nothing was charged.',
      )
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      assertNoForbiddenKeys(v as Record<string, unknown>, `${path}.${k}`)
    }
  }
}

export type ApifyFailureKind = 'egress' | 'auth' | 'missing-actor' | 'credit' | 'other'

/**
 * Classify a non-OK response BEFORE writing an error message for it.
 *
 * The distinction that matters is `egress` vs `auth`: a sandbox or corporate
 * proxy refusing to carry the request answers 403, and so does Apify refusing
 * the token. Reporting the first as the second sends the operator off to
 * rotate a credential that was never implicated — an expensive wrong turn,
 * and one this build walked into before the discriminator existed.
 *
 * The tell is who wrote the body: the Apify API always answers JSON, while a
 * gateway answers plain text and usually sets an explicit deny header.
 */
export function classifyApifyFailure(res: Pick<Response, 'status' | 'headers'>, body: string): ApifyFailureKind {
  const denyReason = res.headers.get('x-deny-reason')
  const contentType = res.headers.get('content-type') ?? ''
  if (denyReason) return 'egress'
  if (!contentType.includes('json') && /allowlist|not allowed|egress|blocked by policy|proxy/i.test(body)) {
    return 'egress'
  }
  if (res.status === 401 || res.status === 403) return 'auth'
  if (res.status === 404) return 'missing-actor'
  if (res.status === 402) return 'credit'
  return 'other'
}

function haltFor(res: Response, body: string, actorId: string): PipelineHalt {
  switch (classifyApifyFailure(res, body)) {
    case 'egress':
      return new PipelineHalt(
        [
          `NETWORK POLICY BLOCKED api.apify.com (HTTP ${res.status}${res.headers.get('x-deny-reason') ? `, ${res.headers.get('x-deny-reason')}` : ''}).`,
          '',
          `The gateway said: ${body.trim().slice(0, 200)}`,
          '',
          'This is the environment refusing to carry the request — it never reached Apify, so the token is',
          'not implicated and nothing was charged. Allow api.apify.com in the environment\'s network egress',
          'settings, or run the actor from a machine with open egress.',
        ].join('\n'),
      )
    case 'auth':
      return new PipelineHalt(
        `Apify rejected the token (HTTP ${res.status}). The token in .env.local is missing, expired, or ` +
        `lacks access to "${actorId}". Check it at apify.com → Settings → Integrations. Nothing was charged.`,
      )
    case 'missing-actor':
      return new PipelineHalt(
        `Apify has no actor "${actorId}" (HTTP 404). Actor names churn — this is exactly the case Part 4b ` +
        'anticipates. Pick another maintained profile-scraper-class actor in config/actors.ts and re-run the ' +
        'smoke test. Nothing was charged.',
      )
    case 'credit':
      return new PipelineHalt(
        'Apify reports insufficient credit (HTTP 402). Top up the account or wait for the free tier to reset. ' +
        'Nothing was charged on our side.',
      )
    default:
      return new PipelineHalt(`Apify API error (HTTP ${res.status}) for "${actorId}": ${body.slice(0, 300)}`)
  }
}

async function apiFetch(url: string, token: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    })
  } catch (e) {
    // A network-level failure is not an API error and must not read like one:
    // this environment can reach some hosts and not others, and saying so
    // plainly saves an hour of chasing a token that is fine.
    throw new PipelineHalt(
      `Could not reach ${new URL(url).host} — ${e instanceof Error ? e.message : String(e)}.\n\n` +
      'This is a network-reachability failure, not an API rejection: the request never arrived, so ' +
      'nothing was charged. If this is a sandboxed environment, its egress policy may not allow the host.',
    )
  }
}

/**
 * Start a run, wait for it to finish, and return its items and real cost.
 *
 * Deliberately NOT the `run-sync-get-dataset-items` shortcut: that endpoint
 * returns items alone, so the only cost figure available would be an estimate
 * of our own invention. Starting the run and reading it back costs two extra
 * requests and buys a real receipt for the `spend` table.
 */
export async function runActor(opts: {
  actorId: string
  input: Record<string, unknown>
  token: string
  /** Hard per-run charge ceiling passed to Apify (pay-per-event actors). */
  maxChargeUsd: number
  timeoutSecs?: number
  memoryMbytes?: number
  pollMs?: number
  onWait?: (status: string, elapsedMs: number) => void
}): Promise<ActorRunResult> {
  const {
    actorId, input, token, maxChargeUsd,
    timeoutSecs = ACTOR_RUN_BOUNDS.timeoutSecs,
    memoryMbytes = ACTOR_RUN_BOUNDS.memoryMbytes,
    pollMs = ACTOR_RUN_BOUNDS.pollMs,
    onWait,
  } = opts

  assertNoForbiddenKeys(input)

  const started = Date.now()
  const q = new URLSearchParams({
    timeout: String(timeoutSecs),
    memory: String(memoryMbytes),
    maxTotalChargeUsd: String(maxChargeUsd),
  })
  const startRes = await apiFetch(`${API}/acts/${actorId}/runs?${q}`, token, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  if (!startRes.ok) throw haltFor(startRes, await startRes.text(), actorId)

  const startBody = (await startRes.json()) as { data?: { id?: string; defaultDatasetId?: string } }
  const runId = startBody.data?.id
  const datasetId = startBody.data?.defaultDatasetId
  if (!runId || !datasetId) {
    throw new PipelineHalt(`Apify accepted the run but returned no run id — unexpected response shape for "${actorId}".`)
  }

  // Poll to a terminal state, bounded by the run timeout plus slack so a
  // wedged run can never hang the pipeline forever.
  const deadline = started + (timeoutSecs + 60) * 1000
  let status = 'READY'
  let usageUsd = 0
  for (;;) {
    const res = await apiFetch(`${API}/actor-runs/${runId}`, token)
    if (!res.ok) throw haltFor(res, await res.text(), actorId)
    const body = (await res.json()) as { data?: { status?: string; usageTotalUsd?: number } }
    status = body.data?.status ?? 'UNKNOWN'
    usageUsd = Number(body.data?.usageTotalUsd ?? 0)
    if (TERMINAL.has(status)) break
    if (Date.now() > deadline) {
      throw new PipelineHalt(
        `Apify run ${runId} was still ${status} after ${Math.round((Date.now() - started) / 1000)}s. ` +
        `Abort it at apify.com if it is stuck. Charged so far (per Apify): $${usageUsd.toFixed(4)}.`,
      )
    }
    onWait?.(status, Date.now() - started)
    await new Promise((r) => setTimeout(r, pollMs))
  }

  // Items are fetched even on a failed run: a partial dataset still tells the
  // operator what the actor's output looks like, which is the smoke test's
  // whole purpose. The caller decides whether a partial run is acceptable.
  let items: Record<string, unknown>[] = []
  const itemsRes = await apiFetch(`${API}/datasets/${datasetId}/items?clean=true&format=json`, token)
  if (itemsRes.ok) {
    const parsed: unknown = await itemsRes.json()
    if (Array.isArray(parsed)) items = parsed as Record<string, unknown>[]
  }

  return { runId, status, usageUsd, items, elapsedMs: Date.now() - started }
}
