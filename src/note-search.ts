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
 * - `create`: the trimmed query when it is non-empty and does not name an existing
 *   note, else `null`. Existence is checked by normalizing the query
 *   (`normalizeNoteName`) and testing membership in `paths`, so a note the raw
 *   fuzzy text wouldn't match is still recognized and offered to open, not create.
 *   An *invalid* name (normalize fails) names no existing note, so it is offered —
 *   the create attempt then surfaces the validation error.
 */
export function searchNotes(query: string, paths: readonly string[]): SearchResult {
  void query
  void paths
  void displayName
  void normalizeNoteName
  throw new Error("stub")
}
