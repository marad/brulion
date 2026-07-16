/**
 * The pure core of the sidebar tree's multi-selection (M37/FEAT-0078): given the
 * current selection (a set of row paths) and the visible rows, compute the next
 * selection for a toggle or a range extension. No DOM — the glue in `ui.ts` holds
 * the live selection, calls these to derive the next set, and paints the rows.
 * Isolated and unit-tested the same way `tree-nav.ts`/`selection`-adjacent cores
 * are, so the set arithmetic is verified without a rendered tree.
 */

/** A copy of `selected` with `path` flipped — added if absent, removed if
 * present. The input is never mutated (toggling is a value operation the caller
 * assigns back), so callers can keep the previous set around. */
export function toggleSelection(selected: ReadonlySet<string>, path: string): Set<string> {
  const next = new Set(selected)
  if (!next.delete(path)) next.add(path)
  return next
}

/** The set of paths in the inclusive span between `anchor` and `focus` in
 * `visiblePaths` draw order — a Shift+arrow range (M37/FEAT-0078). Works in
 * either direction (anchor above or below focus). Returns the span itself, not a
 * union with any prior selection, so repeatedly extending *or* shrinking the
 * range from a fixed anchor is just "recompute the span". If either endpoint is
 * not among `visiblePaths` (e.g. it scrolled into a collapsed folder), the range
 * is empty. */
export function rangeSelect(visiblePaths: string[], anchor: string, focus: string): Set<string> {
  const a = visiblePaths.indexOf(anchor)
  const b = visiblePaths.indexOf(focus)
  if (a === -1 || b === -1) return new Set()
  const [lo, hi] = a <= b ? [a, b] : [b, a]
  return new Set(visiblePaths.slice(lo, hi + 1))
}
