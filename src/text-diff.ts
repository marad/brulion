/**
 * A minimal single-span text diff (FEAT-0067): the one contiguous region that
 * differs between two strings, expressed as a CodeMirror-ready change. Used to
 * reload an externally-changed note by replacing only the differing middle, so the
 * caret and scroll position survive (instead of a wholesale document replace). Pure;
 * no diff library.
 */

/** A single contiguous replacement: replace `old[from, to)` with `insert`. Positions
 * are UTF-16 code-unit offsets into the *old* string — the same units CodeMirror
 * uses, so this drops straight into `view.dispatch({ changes })`. */
export interface TextChange {
  from: number
  to: number
  insert: string
}

/**
 * The minimal single-span change turning `old` into `next`: the longest common
 * prefix and (non-overlapping) longest common suffix are kept, and only the middle
 * span between them is replaced. Returns `null` when the strings are identical (no
 * change to dispatch). Applying the result to `old`
 * (`old.slice(0, from) + insert + old.slice(to)`) always yields `next` exactly.
 */
export function diffRange(old: string, next: string): TextChange | null {
  if (old === next) return null
  const oldLen = old.length
  const nextLen = next.length
  const max = Math.min(oldLen, nextLen)

  // Longest common prefix.
  let prefix = 0
  while (prefix < max && old.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix++

  // Longest common suffix, capped so it can't reach back into the prefix (else a run
  // like "aaaa"→"aa" would count the same chars twice and produce from > to).
  let suffix = 0
  const maxSuffix = max - prefix
  while (
    suffix < maxSuffix &&
    old.charCodeAt(oldLen - 1 - suffix) === next.charCodeAt(nextLen - 1 - suffix)
  ) {
    suffix++
  }

  return { from: prefix, to: oldLen - suffix, insert: next.slice(prefix, nextLen - suffix) }
}
