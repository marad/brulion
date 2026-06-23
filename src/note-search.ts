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

/** Characters that begin a new "segment" of a name — a match right after one (or
 * at the very start) reads as a word/path-segment start and is rewarded. */
function isSeparator(ch: string): boolean {
  return ch === " " || ch === "/" || ch === "-" || ch === "_"
}

/** Whether position `i` in `t` begins a segment (string start, or after a
 * separator) — the spot a word/path segment starts and a match is most wanted. */
function isBoundary(t: string, i: number): boolean {
  return i === 0 || isSeparator(t[i - 1])
}

// Scoring weights. The two tiers live in disjoint bands: any literal substring
// match (tier 1) scores at least SUBSTRING_BASE, while tier 2 is clamped to stay
// strictly below it (see below) — so a substring match always outranks a gapped
// one, for any input length.
const CHAR = 10 // per matched character
const BOUNDARY = 10 // matched char sits at a segment start
const CONTIG = 5 // matched char is adjacent to the previous match
const GAP = 1 // per character skipped *between* two matches (interior gaps only)
const SUBSTRING_BASE = 100_000

/**
 * Case-insensitive fuzzy score of `query` within `target`. Returns `null` when
 * `query` is not even a subsequence of `target`; otherwise a number where higher
 * is a better match. An empty query scores `0` (matches everything). Pure & total.
 *
 * Two tiers (FEAT-0038):
 * - **Literal contiguous substring wins.** If `query` occurs contiguously, it
 *   scores in a band strictly above any gapped match, ranked by where the run
 *   begins — a segment-start occurrence beats a mid-token one.
 * - **Best-alignment subsequence** otherwise — the maximum over *all* alignments
 *   (a small DP, not greedy), rewarding contiguity and segment-start hits.
 *
 * Folder depth costs nothing: there is no leading-distance penalty, only interior
 * gaps (characters skipped *between* two matched characters) are penalized — so a
 * note ranks by its name whether it sits at the root or deep in a folder tree.
 */
export function fuzzyScore(query: string, target: string): number | null {
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  if (q.length === 0) return 0

  // Tier 1 — literal contiguous substring. Take the best occurrence, preferring
  // one that begins at a segment boundary.
  let substring: number | null = null
  for (let p = t.indexOf(q); p !== -1; p = t.indexOf(q, p + 1)) {
    const s = SUBSTRING_BASE + (isBoundary(t, p) ? BOUNDARY : 0)
    if (substring === null || s > substring) substring = s
  }
  if (substring !== null) return substring

  // Tier 2 — best-alignment subsequence. `row[j]` = the best score for matching
  // the query prefix so far with its last char placed at `t[j]` (−∞ = impossible).
  const NEG = -Infinity
  let row = new Array<number>(t.length).fill(NEG)
  for (let j = 0; j < t.length; j++) {
    if (t[j] === q[0]) row[j] = CHAR + (isBoundary(t, j) ? BOUNDARY : 0)
  }
  for (let i = 1; i < q.length; i++) {
    const next = new Array<number>(t.length).fill(NEG)
    // A predecessor at j' contributes `row[j'] − GAP·(j − j' − 1)` — i.e. its own
    // score minus a penalty for the chars skipped between it and j. Rearranged,
    // `row[j'] − GAP·(j−1) + GAP·j'`, so the best gapped predecessor over all
    // j' < j is `max(row[j'] + GAP·j') − GAP·(j−1)`; `prefixMax` carries that
    // running max so each j stays O(1).
    let prefixMax = NEG
    for (let j = 0; j < t.length; j++) {
      if (j > 0 && row[j - 1] > NEG) prefixMax = Math.max(prefixMax, row[j - 1] + GAP * (j - 1))
      if (t[j] !== q[i]) continue
      let pred = prefixMax > NEG ? prefixMax - GAP * (j - 1) : NEG // gapped (penalized)
      if (j > 0 && row[j - 1] > NEG) pred = Math.max(pred, row[j - 1] + CONTIG) // contiguous: no gap, rewarded
      if (pred > NEG) next[j] = CHAR + (isBoundary(t, j) ? BOUNDARY : 0) + pred
    }
    row = next
  }
  let best = NEG
  for (const s of row) if (s > best) best = s
  if (best === NEG) return null
  // Keep tier 2 strictly below the substring band, so a literal substring match
  // always wins regardless of how long the inputs are (the clamp only ever bites
  // on absurdly long queries — real note names never approach it).
  return Math.min(best, SUBSTRING_BASE - 1)
}

/**
 * Update a most-recently-visited (MRU) list of note paths (FEAT-0039): return a
 * new list with `path` moved to the front, deduplicated, and capped to `cap`
 * entries (the oldest beyond the cap drop off). Pure — the input is not mutated.
 */
export function touchRecency(
  list: readonly string[],
  path: string,
  cap = 50,
): string[] {
  return [path, ...list.filter((p) => p !== path)].slice(0, cap)
}

/**
 * Rank the known note `paths` against `query` and decide whether `query` is a
 * valid *new* note name to offer for creation. Pure & total (never throws):
 *
 * - `matches`: paths whose display form (no `.md`) fuzzily matches `query`, sorted
 *   by score desc, then by recency (most-recently-visited first), then path asc.
 *   `recency` (FEAT-0039) is a most-recently-visited list of paths; it only breaks
 *   ties between equally-scored matches — never added into the score, so a recent
 *   weak match cannot outrank a better one. On an empty query every score is `0`,
 *   so the order collapses to recency-first then name order. Stale recency entries
 *   (paths not in `paths`) never appear and do not perturb the order.
 * - `create`: the trimmed query when it is non-empty and does not name an existing
 *   note, else `null`. Existence is checked by normalizing the query
 *   (`normalizeNoteName`) and testing membership in `paths`, so a note the raw
 *   fuzzy text wouldn't match is still recognized and offered to open, not create.
 *   An *invalid* name (normalize fails) names no existing note, so it is offered —
 *   the create attempt then surfaces the validation error.
 */
export function searchNotes(
  query: string,
  paths: readonly string[],
  recency: readonly string[] = [],
): SearchResult {
  const trimmed = query.trim()
  const rank = new Map(recency.map((path, i) => [path, i]))
  // Never-visited paths all share one finite rank past the last real index, so two
  // of them compare equal (0) and fall through to the path tiebreak — using
  // Infinity here would make `rankOf(a) - rankOf(b)` NaN for two such paths.
  const rankOf = (path: string): number => rank.get(path) ?? recency.length
  const matches = paths
    .map((path) => ({ path, score: fuzzyScore(trimmed, displayName(path)) }))
    .filter((m): m is { path: string; score: number } => m.score !== null)
    .sort(
      (a, b) =>
        b.score - a.score ||
        rankOf(a.path) - rankOf(b.path) ||
        (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
    )
    .map((m) => m.path)

  let create: string | null = null
  if (trimmed) {
    const norm = normalizeNoteName(trimmed)
    const exists = norm.ok && paths.includes(norm.filename)
    if (!exists) create = trimmed
  }

  return { matches, create }
}
