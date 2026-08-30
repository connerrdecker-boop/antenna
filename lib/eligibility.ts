/**
 * ELIGIBILITY — the hard gates that run BEFORE any model reads a profile
 * (ratified 2026-08-30, A2 calibration close).
 *
 * A rubric dimension is a judgement with points attached. This is not that. An
 * account holder who is a minor is not a prospect at any score, so the answer
 * cannot be a number the model weighs against a good DM funnel — it is a gate
 * in code that forces tier X without a paid call and without the model's
 * opinion being consulted at all.
 *
 * THE PRECEDENT CASE (#17 in the A2 ratify pass). @tommy_lifts10's bio opens
 * "16y / I want to inspire you". The pre-score noticed — "Age indicator (16y)
 * suggests minor" — but noticing is not a gate: the profile was still
 * full-scored, still cost sonnet money, and still reached the operator as a
 * judgement call rather than as an ineligibility. The operator rejected it and
 * then ruled that this must never be a judgement call again.
 *
 * FALSE POSITIVES ARE THE EXPENSIVE ERROR, so the detector is deliberately
 * narrow. "17 years experience" is an adult coach's credential, "16 week
 * program" is an offer, and "2016" is a year; each would be a silently lost
 * prospect if this fired on them. A missed minor is caught downstream — the
 * row still enters /ratify, where the operator has the last word, exactly as a
 * private account does. So the rule is: match age markers that can only be
 * ages, and stand down wherever the surrounding words say duration.
 */

/**
 * Age tokens: 10–17 followed by a marker that reads as an AGE, not a duration.
 * The lookbehind rejects a digit, dot, comma or dash before the number, so
 * "2016y" and "10-16 yrs" cannot match.
 */
const AGE_TOKEN = /(?<![\d.,\-–—])(1[0-7])\s*(?:y\/o|y\.?o\.?|yrs?\b|years?\b|y\b)/gi

/** An explicit label, which needs no disambiguation. */
const AGE_LABEL = /\bage\s*[:=-]?\s*(1[0-7])\b/i

/**
 * Words that turn an age token into a duration. "17 years EXPERIENCE" is a
 * credential; "16 years OLD" is an age. When neither appears the token stands
 * on its own — which is the "16y" case the rule was written for.
 */
const DURATION_AFTER = /^\s*(?:of\s+)?(?:experience|exp|coaching|training|lifting|in\s+the\s+game|in\s+business|running|teaching|competing|natural|deep|strong|pro)\b/i

/** Words that confirm an age reading outright. */
const AGE_AFTER = /^\s*old\b/i

export type MinorIndication = { matched: string; why: string }

/**
 * Returns the evidence when the text indicates a minor, or null.
 *
 * Deliberately scoped to bio and display name — the fields the account holder
 * writes about THEMSELVES. Captions are excluded on purpose: "my 16 year old
 * client" and "coaching since I was 15" are an adult's words, and scanning
 * them would turn this gate into a generator of false positives.
 */
export function minorIndication(bio: string | null, name: string | null = null): MinorIndication | null {
  for (const field of [bio, name]) {
    if (!field) continue

    const labelled = field.match(AGE_LABEL)
    if (labelled) {
      return { matched: labelled[0].trim(), why: `bio states an age of ${labelled[1]}` }
    }

    AGE_TOKEN.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = AGE_TOKEN.exec(field)) !== null) {
      const after = field.slice(m.index + m[0].length)
      if (AGE_AFTER.test(after)) {
        return { matched: `${m[0].trim()} old`, why: `bio states an age of ${m[1]}` }
      }
      if (DURATION_AFTER.test(after)) continue // a credential, not an age
      return { matched: m[0].trim(), why: `bio carries the age marker "${m[0].trim()}"` }
    }
  }
  return null
}
