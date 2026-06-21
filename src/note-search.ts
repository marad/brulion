import { displayName, normalizeNoteName } from "./note-name"

/** What the switcher renders for a query: ranked existing matches plus, when the
 * query is worth offering as a new note, the string to attempt creating. */
export interface SearchResult {
  /** Matching note paths (with `.md`), best match first. */
  matches: string[]
  /**
   * The trimmed query to offer for creation, or `null`. Present whenever the query
   * is non-empty and does not name an existing note — including an *invalid* name,
   * so the user can still trigger it and get the validation error from the create
   * path (the switcher passes this straight to `createNote`). `null` when the query
   * is empty or normalizes to a note already in `paths` (offered to open, not
   * create).
   */
  create: string | null
}

/**
 * Case-insensitive subsequence score of `query` within `target`. Returns `null`
 * when `query` is not a subsequence of `target`; otherwise a number where higher
 * is a better match (contiguous runs and segment-start hits score higher). An
 * empty query scores `0` (matches everything). Pure & total.
 */
/** Characters that begin a new "segment" of a name — a match right after one (or
 * at the very start) reads as a word/path-segment start and is rewarded. */
function isSeparator(ch: string): boolean {
  return ch === " " || ch === "/" || ch === "-" || ch === "_"
}

export function fuzzyScore(query: string, target: string): number | null {
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  if (q.length === 0) return 0

  let score = 0
  let qi = 0
  let prevMatch = -1
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue
    // Skipped chars since the previous match (or the leading distance for the
    // first match). Gaps are penalized so contiguous, earlier runs win.
    const gap = prevMatch >= 0 ? ti - prevMatch - 1 : ti
    let bonus = 0
    if (ti === 0 || isSeparator(t[ti - 1])) bonus += 10 // segment start
    if (prevMatch === ti - 1) bonus += 5 // contiguous with the previous match
    score += 10 + bonus - 3 * gap
    prevMatch = ti
    qi++
  }
  return qi === q.length ? score : null
}

/**
 * Rank the known note `paths` against `query` and decide whether `query` is a
 * valid *new* note name to offer for creation. Pure & total (never throws):
 *
 * - `matches`: paths whose display form (no `.md`) fuzzily matches `query`, sorted
 *   by score desc then path asc; an empty query yields all paths in name order.
 * - `create`: the trimmed query when it is non-empty and does not name an existing
 *   note, else `null`. Existence is checked by normalizing the query
 *   (`normalizeNoteName`) and testing membership in `paths`, so a note the raw
 *   fuzzy text wouldn't match is still recognized and offered to open, not create.
 *   An *invalid* name (normalize fails) names no existing note, so it is offered —
 *   the create attempt then surfaces the validation error.
 */
export function searchNotes(query: string, paths: readonly string[]): SearchResult {
  const trimmed = query.trim()
  const matches = paths
    .map((path) => ({ path, score: fuzzyScore(trimmed, displayName(path)) }))
    .filter((m): m is { path: string; score: number } => m.score !== null)
    .sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((m) => m.path)

  let create: string | null = null
  if (trimmed) {
    const norm = normalizeNoteName(trimmed)
    const exists = norm.ok && paths.includes(norm.filename)
    if (!exists) create = trimmed
  }

  return { matches, create }
}
