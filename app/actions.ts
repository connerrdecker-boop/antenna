'use server'
/**
 * Server actions — the app's only mutation surface. Every one of these
 * re-validates its input: the client is untrusted even when the client is a
 * localhost page Conner is looking at.
 */
import { revalidatePath } from 'next/cache'
import { DIRECTIONS, LOI_TIERS, STATUSES, type Direction, type LoiTier, type Status } from '@/db/enums'
import {
  addCandidates, getCandidateDetail, logOutreach, setNextActionDate,
  transitionStatus, updateNotes,
  type AddOutcome, type CandidateDetail,
} from '@/db/repo'

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string }

function fail(e: unknown): { ok: false; error: string } {
  return { ok: false, error: e instanceof Error ? e.message : String(e) }
}

const asId = (v: unknown): number => {
  const n = Number(v)
  if (!Number.isInteger(n) || n <= 0) throw new Error('invalid candidate id')
  return n
}

export async function fetchDetail(id: number): Promise<ActionResult<CandidateDetail | null>> {
  try {
    return { ok: true, data: getCandidateDetail(asId(id)) }
  } catch (e) {
    return fail(e)
  }
}

export async function doTransition(
  id: number,
  to: string,
  note?: string,
  loiTier?: string,
): Promise<ActionResult<CandidateDetail | null>> {
  try {
    const cid = asId(id)
    if (!STATUSES.includes(to as Status)) throw new Error(`unknown status "${to}"`)
    if (loiTier && !LOI_TIERS.includes(loiTier as LoiTier)) throw new Error(`unknown loi_tier "${loiTier}"`)
    transitionStatus(cid, to as Status, {
      note: note?.trim() || null,
      loiTier: (loiTier as LoiTier | undefined) ?? undefined,
    })
    revalidatePath('/pipeline')
    return { ok: true, data: getCandidateDetail(cid) }
  } catch (e) {
    return fail(e)
  }
}

export async function saveNotes(id: number, notes: string): Promise<ActionResult> {
  try {
    updateNotes(asId(id), notes)
    revalidatePath('/pipeline')
    return { ok: true, data: null }
  } catch (e) {
    return fail(e)
  }
}

export async function saveNextAction(id: number, date: string): Promise<ActionResult> {
  try {
    const d = date.trim()
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error('next action must be YYYY-MM-DD')
    setNextActionDate(asId(id), d || null)
    revalidatePath('/pipeline')
    return { ok: true, data: null }
  } catch (e) {
    return fail(e)
  }
}

export async function addOutreachEntry(
  id: number,
  direction: string,
  text: string,
): Promise<ActionResult<CandidateDetail | null>> {
  try {
    const cid = asId(id)
    if (!DIRECTIONS.includes(direction as Direction)) throw new Error('direction must be out|in')
    if (!text.trim()) throw new Error('log the actual text — it is what makes reply-rate learning possible')
    logOutreach(cid, direction as Direction, text.trim())
    revalidatePath('/pipeline')
    return { ok: true, data: getCandidateDetail(cid) }
  } catch (e) {
    return fail(e)
  }
}

/**
 * /add (Part 4d). Accepts pasted handles/URLs (newline, comma or space
 * separated) and CSV text. Dedupes on handle: existing rows are surfaced.
 */
export async function submitAdd(raw: string, csv: string): Promise<ActionResult<AddOutcome[]>> {
  try {
    const tokens = [...parseFreeText(raw), ...parseCsv(csv)]
    if (!tokens.length) return { ok: false, error: 'nothing to add' }
    const outcomes = addCandidates(tokens, 'manual')
    revalidatePath('/pipeline')
    return { ok: true, data: outcomes }
  } catch (e) {
    return fail(e)
  }
}

/**
 * Split a paste into candidate tokens.
 *
 * Deliberately does NOT split on plain spaces by default: a pasted sentence
 * ("this is not a handle") would otherwise explode into six perfectly
 * valid-looking handles and quietly pollute the pool. Chunks are split on
 * newlines, commas, semicolons and tabs; a chunk containing spaces is only
 * split further when EVERY part of it already looks like a handle or a URL
 * (so "@a @b @c" on one line still works), and is otherwise passed through
 * whole so it fails visibly as one unusable input.
 */
function parseFreeText(raw: string): string[] {
  const looksAddressable = (t: string) => t.startsWith('@') || /^(https?:\/\/|www\.)/i.test(t) || /(^|\.)instagram\.com\//i.test(t)
  return (raw ?? '')
    .split(/[\n\r,;\t]+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .flatMap((chunk) => {
      if (!/\s/.test(chunk)) return [chunk]
      const parts = chunk.split(/\s+/).filter(Boolean)
      return parts.every(looksAddressable) ? parts : [chunk]
    })
}

/**
 * CSV: takes the first column of every row, skipping a header row whose first
 * cell is an obvious column name. Quoted cells are unwrapped.
 */
function parseCsv(csv: string): string[] {
  const lines = (csv ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (!lines.length) return []
  const cell = (line: string) => {
    const first = line.split(',')[0].trim()
    return first.replace(/^"(.*)"$/, '$1').trim()
  }
  const out = lines.map(cell)
  if (out.length && /^(handle|username|user|ig|instagram|profile|url|account)$/i.test(out[0])) out.shift()
  return out.filter(Boolean)
}
