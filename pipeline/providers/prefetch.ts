/**
 * Batch prefetch, without disturbing the enrich gate.
 *
 * enrichCandidate() takes one candidate and one provider, and that shape is
 * load-bearing: the Part V gate lives inside it and every enrichment writes
 * its own observation. Rather than teach it about batches, prefetch() runs the
 * provider's batch door ONCE and hands back a provider that serves the results
 * from memory. The gate, the observation write and the per-candidate flow are
 * untouched; only the number of network round trips changes.
 *
 * A handle the batch did not return resolves to null — the same "no data"
 * outcome the per-handle path produces — so a partial actor run degrades into
 * partial enrichment rather than an exception.
 */
import type { ProfilePacket, ProfileProvider } from '../types'

export async function prefetch(
  provider: ProfileProvider,
  handles: readonly string[],
): Promise<{ provider: ProfileProvider; fetched: number; batched: boolean }> {
  if (!provider.fetchProfiles || handles.length === 0) {
    return { provider, fetched: 0, batched: false }
  }

  const packets = await provider.fetchProfiles(handles)
  const byHandle = new Map<string, ProfilePacket>()
  for (const p of packets) byHandle.set(p.handle.toLowerCase(), p)

  return {
    batched: true,
    fetched: byHandle.size,
    provider: {
      name: provider.name,
      async fetchProfile(handle: string): Promise<ProfilePacket | null> {
        return byHandle.get(handle.toLowerCase()) ?? null
      },
    },
  }
}
