/** JSON columns are stored as TEXT (Part III). These are the only readers/writers. */

export function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

export function parseJsonObject<T = Record<string, unknown>>(value: string | null | undefined): T | null {
  if (!value) return null
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as T) : null
  } catch {
    return null
  }
}

export function toJson(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return JSON.stringify(value)
}

/** Shape of candidates.extracted (Part III / Part 6.2). */
export type Extracted = {
  name?: string
  offers?: { type: string; price?: string | null }[]
  lead_magnet?: string | null
  /** Part 4.6 passive capture. */
  tiktok_url?: string | null
}
