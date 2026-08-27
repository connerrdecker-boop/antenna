/**
 * ════════════════════════════ A3 WIRING POINT ════════════════════════════
 *
 * The actor-backed profile provider — an Apify-class "Instagram profile
 * scraper" actor, NO LOGIN, no cookies ever (Law 3). This is a deliberate
 * STUB: phase A3 selects a currently-maintained actor, smoke-tests it with a
 * <= $2 run, and implements fetchProfile against it. Costs go through
 * ensureBudget('actors', …) BEFORE the run and recordSpend('actors', …) after.
 *
 * Until then every call halts with a pointer at the fixture/manual provider,
 * so nothing upstream can mistake the stub for a data source.
 * ══════════════════════════════════════════════════════════════════════════
 */
import { PipelineHalt } from '@/lib/env'
import type { ProfileProvider } from '../types'

export function actorProvider(): ProfileProvider {
  return {
    name: 'actor',
    async fetchProfile(handle: string): Promise<never> {
      throw new PipelineHalt(
        `The actor-backed profile provider is not wired until phase A3 (requested for @${handle}). ` +
        `Use --provider=fixture, which reads committed fixtures plus real packets you drop into ./profiles/*.json.`,
      )
    },
  }
}
