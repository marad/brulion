import { displayName, normalizeNoteName } from "./note-name"

/** What the switcher renders for a query: ranked existing matches plus, when the
 * query names a valid *new* note, the normalized filename to create. */
export interface SearchResult {
  /** Matching note paths (with `.md`), best match first. */
  matches: string[]
  /** Normalized create target (with `.md`) when the query names a valid new note,
   * else `null`. Label is `displayName(create)`; it is also the create arg. */
  create: string | null
}

/**
 * Case-insensitive subsequence score of `query` within `target`. Returns `null`
 * when `query` is not a subsequence of `target`; otherwise a number where higher
 * is a better match (contiguous runs and segment-start hits score higher). An
 * empty query scores `0` (matches everything). Pure & total.
 */
export function fuzzyScore(query: string, target: string): number | null {
  void query
  void target
  throw new Error("stub")
}

/**
 * Rank the known note `paths` against `query` and decide whether `query` is a
 * valid *new* note name to offer for creation. Pure & total (never throws):
 *
 * - `matches`: paths whose display form (no `.md`) fuzzily matches `query`, sorted
 *   by score desc then path asc; an empty query yields all paths in name order.
 * - `create`: present iff the trimmed query is non-empty, `normalizeNoteName`
 *   accepts it, and the normalized filename is not already in `paths` (so an
 *   existing note — even one the raw text wouldn't match — is never offered for
 *   creation).
 */
export function searchNotes(query: string, paths: readonly string[]): SearchResult {
  void query
  void paths
  void displayName
  void normalizeNoteName
  throw new Error("stub")
}
