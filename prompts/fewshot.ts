/**
 * PART 6.5 — THE FEW-SHOT LOOP. The cheapest possible learning.
 *
 * Builds {FEW_SHOT_BLOCK} from the ratifications table: up to 10 recent
 * decisions, balanced approve/reject, each rendered as a compact labeled
 * example with Conner's reason. Every ratification makes the scorer more
 * Conner-shaped. No fine-tuning theater.
 *
 * Balance means balance: up to 5 most-recent approves and up to 5 most-recent
 * rejects — a lopsided history never floods the block with one class.
 * `bank` and `flag` decisions are metro calls and indecision respectively;
 * Part 6.5 names approve/reject as the training signal, so only those two feed
 * the block.
 */
import type BetterSqlite3 from 'better-sqlite3'
import { getSqlite } from '@/db/connection'

const PER_SIDE = 5

type ExampleRow = {
  decision: 'approve' | 'reject'
  reason: string | null
  at: string
  handle: string
  follower_count: number | null
  bio: string | null
  tier: string | null
  score: number | null
}

function recentDecisions(
  sqlite: BetterSqlite3.Database,
  decision: 'approve' | 'reject',
  limit: number,
): ExampleRow[] {
  return sqlite
    .prepare(
      `SELECT r.decision, r.reason, r.at,
              c.handle, c.follower_count, c.bio, c.tier, c.score
       FROM ratifications r
       JOIN candidates c ON c.id = r.candidate_id
       WHERE r.decision = ?
       ORDER BY r.id DESC
       LIMIT ?`,
    )
    .all(decision, limit) as ExampleRow[]
}

function renderExample(r: ExampleRow): string {
  const label = r.decision === 'approve' ? 'APPROVED' : 'REJECTED'
  const facts = [
    r.follower_count !== null ? `${r.follower_count} followers` : null,
    r.tier ? `scored ${r.tier}${r.score !== null ? ` ${r.score}` : ''}` : null,
  ].filter(Boolean).join(', ')
  const bio = (r.bio ?? '').replace(/\s+/g, ' ').trim().slice(0, 110)
  const reason = (r.reason ?? '').trim()
  return [
    `- ${label} @${r.handle}${facts ? ` (${facts})` : ''}`,
    bio ? `  bio: "${bio}"` : null,
    reason ? `  operator's reason: "${reason}"` : null,
  ].filter(Boolean).join('\n')
}

/**
 * The block that replaces {FEW_SHOT_BLOCK} in prompts/score_v1.md.
 * Empty string when no decisions exist yet — the prompt stands alone.
 */
export function buildFewShotBlock(sqlite: BetterSqlite3.Database = getSqlite()): string {
  const approves = recentDecisions(sqlite, 'approve', PER_SIDE)
  const rejects = recentDecisions(sqlite, 'reject', PER_SIDE)
  if (!approves.length && !rejects.length) return ''

  // Interleave most-recent-first so neither class leads by construction.
  const examples: string[] = []
  for (let i = 0; i < PER_SIDE; i++) {
    if (approves[i]) examples.push(renderExample(approves[i]))
    if (rejects[i]) examples.push(renderExample(rejects[i]))
  }

  return [
    'CALIBRATION — the operator has ruled on these recent prospects. Match this taste:',
    ...examples,
  ].join('\n')
}

/** score_v1.md with the {FEW_SHOT_BLOCK} slot filled (or removed when empty). */
export function assembleScorePrompt(template: string, sqlite?: BetterSqlite3.Database): string {
  const block = buildFewShotBlock(sqlite)
  if (block) return template.replace('{FEW_SHOT_BLOCK}', block)
  // No decisions yet: drop the slot line entirely so the model never sees
  // a dangling placeholder.
  return template.replace(/^\{FEW_SHOT_BLOCK\}\n?/m, '')
}
