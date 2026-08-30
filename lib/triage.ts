/**
 * ZERO-COST TRIAGE — the filter between harvest and the first paid call.
 *
 * WHY IT EXISTS. 4b returns a handle feed: a hashtag post carries no bio and
 * no follower count, so a harvested row has nothing for the cheap filter to
 * read and takes the bootstrap-enrich door instead. That inverts the spine —
 * we pay the profile actor BEFORE the pre-score rather than after — and the
 * smoke test showed exactly who we would be paying for: `@flexfitnessdigital`
 * ("Websites for Fitness Coaches & Brands"), `@smdesigns.coachtools`, and a
 * chiropractor, riding along with the real coaches.
 *
 * So this runs first, on the two fields a handle-only row actually has: the
 * HANDLE and the display NAME. It costs nothing, calls nothing, and its whole
 * job is to stop us buying an enrich for a company that sells software to
 * coaches.
 *
 * FALSE POSITIVES ARE THE EXPENSIVE DIRECTION, and more so here than in the
 * eligibility gate: a triaged row is killed before anything ever looks at it,
 * so there is no bio, no caption and no score to notice the mistake by. The
 * rules are therefore deliberately few and deliberately literal. The B2B
 * vendor signature — selling TO coaches — is unambiguous in a way that
 * "sounds a bit commercial" is not, and only the unambiguous half is encoded.
 *
 * REVERSIBILITY. A killed row is not deleted and not tombstoned. It stays a
 * `sourced` candidate with `triage kill: <rule>` in `notes`, which is what
 * excludes it from enrichment. Clear the note and it flows again — the
 * operator can audit and overturn every one.
 */

export type TriageRule = {
  id: string
  why: string
  /** Tested against the display name AND a separator-stripped handle+name. */
  pattern: RegExp
}

/**
 * ACTIVE RULES. Narrow on purpose — see the header. Each one encodes "this
 * account sells TO coaches" or "this account is a product, not a person",
 * which are the two shapes the 4b smoke actually surfaced.
 */
export const TRIAGE_RULES: readonly TriageRule[] = [
  {
    id: 'sells-to-coaches',
    why: 'markets its product TO coaches rather than coaching clients',
    // "Websites for Fitness Coaches", "for trainers", "coach tools".
    // `coachtools` (no separator) is why the handle is tested stripped.
    pattern: /\bfor\s+(?:fitness\s+|online\s+|personal\s+)?(?:coaches|trainers)\b|coach(?:ing)?tools?\b|coach(?:ing)?\s+tools?\b/i,
  },
  {
    id: 'web-or-software-vendor',
    why: 'a web/design/software vendor, not a coaching business',
    pattern: /\bwebsites?\s+for\b|\bweb\s*design\b|\bsm\s*designs?\b|\btemplates?\b|\bsoftware\b|\bsaas\b|\bfunnel\s*builder\b/i,
  },
  {
    id: 'agency',
    why: 'a marketing/media agency selling services, not a coach',
    pattern: /\b(?:marketing|media|social\s*media|advertising|growth)\s+agency\b|\bagency\s+for\b/i,
  },
]

export type TriageVerdict = { rule: string; why: string; matched: string }

/** Separator-stripped, lowercased — so `coachtools` and `coach tools` both match. */
function stripped(s: string): string {
  return s.toLowerCase().replace(/[._\-|·•/\\]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Returns the kill verdict, or null to let the row through.
 *
 * Deliberately takes only handle and name: those are the fields a 4b row has
 * before anything is paid for, and a triage that needed a bio would be running
 * after the cost it exists to avoid.
 */
export function triageKill(handle: string, name: string | null): TriageVerdict | null {
  const haystacks = [name ?? '', stripped(`${handle} ${name ?? ''}`)]
  for (const rule of TRIAGE_RULES) {
    for (const hay of haystacks) {
      const m = hay.match(rule.pattern)
      if (m) return { rule: rule.id, why: rule.why, matched: m[0].trim() }
    }
  }
  return null
}

/** The marker written to `notes`. Its presence is what excludes the row. */
export const TRIAGE_NOTE_PREFIX = 'triage kill:'
export const triageNote = (v: TriageVerdict): string =>
  `${TRIAGE_NOTE_PREFIX} ${v.rule} — ${v.why} (matched "${v.matched}")`
