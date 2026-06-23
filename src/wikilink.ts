import { displayName, resolveWikilink } from "./note-name"

/**
 * Pure helpers for wikilink *text* — the single home for "what string represents
 * this link", shared by the autocomplete insert (FEAT-0037), the right-click form
 * toggle, and the renderer's scanning. No DOM/FSA/CodeMirror dependency, so the
 * logic that decides a link's on-disk form is unit-tested directly.
 */

/** `[[target]]` / `[[target|alias]]`. The target/alias char classes exclude
 * `[`, `]`, `|` so a malformed or empty form simply doesn't match. */
export const WIKILINK_RE = /\[\[([^\]\[|]+)(?:\|([^\]\[]+))?\]\]/g

/** The filename of a `/`-separated path (the part after the last `/`). */
function basename(path: string): string {
  const slash = path.lastIndexOf("/")
  return slash === -1 ? path : path.slice(slash + 1)
}

/**
 * The shortest *unambiguous* link text for a note `path` among `allPaths`
 * (Obsidian's "shortest path when possible"): the bare basename (`.md` stripped,
 * no folder) when that basename is **unique** in the vault, else the full display
 * path. The bare form reads cleaner and survives the note moving folders; the full
 * form is used only on a basename collision so the link still resolves to exactly
 * this note (a bare ambiguous name would resolve to the first match — FEAT-0027).
 */
export function shortestLinkText(path: string, allPaths: Iterable<string>): string {
  const baseLower = basename(path).toLowerCase()
  let count = 0
  for (const p of allPaths) {
    if (basename(p).toLowerCase() === baseLower && ++count > 1) break
  }
  return displayName(count <= 1 ? basename(path) : path)
}

/** A `[[…]]` found in a document. `target`/`alias` are the raw captured text;
 * `[from, to)` spans the whole link, `[targetFrom, targetTo)` spans just the
 * target (so a rewrite can keep the alias and brackets). */
export interface FoundWikilink {
  from: number
  to: number
  target: string
  targetFrom: number
  targetTo: number
  alias: string | null
}

/** Every `[[…]]` in `text`, in document order — the single place wikilink span,
 * target, and alias offsets are derived, shared by {@link findWikilinkAt} and the
 * rename rewrite (FEAT-0040). Uses a fresh regex so it never races the shared
 * `WIKILINK_RE`'s `lastIndex`. */
export function findWikilinks(text: string): FoundWikilink[] {
  const re = new RegExp(WIKILINK_RE.source, "g")
  const found: FoundWikilink[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const from = m.index
    const targetFrom = from + 2
    found.push({
      from,
      to: from + m[0].length,
      target: m[1],
      targetFrom,
      targetTo: targetFrom + m[1].length,
      alias: m[2] ?? null,
    })
  }
  return found
}

/** The wikilink whose span contains `pos` (edges inclusive), or `null`. */
export function findWikilinkAt(text: string, pos: number): FoundWikilink | null {
  return findWikilinks(text).find((w) => pos >= w.from && pos <= w.to) ?? null
}

/** The right-click "switch a link's form" action. */
export interface WikilinkToggle {
  /** Target sub-range to replace (alias and brackets are left intact). */
  from: number
  to: number
  /** The toggled target text. */
  insert: string
  /** Menu label describing the switch. */
  label: string
}

/**
 * Compute the form toggle for the wikilink at `pos` (FEAT-0037), or `null` when
 * none applies. Returns `null` unless the link resolves to an existing note whose
 * **full** and **shortest** forms differ — i.e. a nested note with a unique
 * basename. A root-level note (forms equal), an ambiguous basename (the name-only
 * form would retarget), and a dangling link (nothing to canonicalize) all yield
 * `null`, so the menu item is simply not offered. Direction is decided by the
 * current target: if it already equals the full path, the toggle goes to the
 * name-only form ("Use name only"), else to the full path ("Use full path").
 */
export function computeWikilinkToggle(
  text: string,
  pos: number,
  notePaths: ReadonlySet<string>,
): WikilinkToggle | null {
  const found = findWikilinkAt(text, pos)
  if (!found) return null
  const target = found.target.trim()
  const { resolved } = resolveWikilink(target, notePaths)
  if (!resolved) return null
  const full = displayName(resolved)
  const short = shortestLinkText(resolved, notePaths)
  if (full === short) return null // root note or ambiguous basename — no safe toggle
  const currentlyFull = target.toLowerCase() === full.toLowerCase()
  return {
    from: found.targetFrom,
    to: found.targetTo,
    insert: currentlyFull ? short : full,
    label: currentlyFull ? "Use name only" : "Use full path",
  }
}
