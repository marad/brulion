/**
 * The pure core of the sidebar tree's keyboard navigation (M36/FEAT-0075):
 * given the currently *visible* rows and which one has focus, decide what a
 * pressed key does. No DOM, no FSA — the DOM glue in `ui.ts` reads the visible
 * rows off the rendered tree, calls this, and executes the returned action
 * (move focus / toggle a folder / activate a row). Isolating the decision here
 * keeps the traversal rules (skip collapsed children, don't wrap, Right/Left
 * expand-or-descend / collapse-or-ascend) unit-testable without a rendered
 * tree, the same way `link-rewrite.ts`/`note-name.ts` isolate their cores.
 */

/** One visible row, in draw order. `depth` is the nesting level — the number of
 * `/` in `path` (a root note/folder is 0, a child of a root folder is 1, …) —
 * which is what makes "the parent is the nearest earlier row one level up" and
 * "the first child is the very next row one level down" computable from the
 * flat list alone. `expanded` is meaningful only for a folder. */
export interface TreeRow {
  path: string
  kind: "note" | "folder"
  expanded: boolean
  depth: number
}

/** What a key press resolves to. `index` names the row it acts on (the target
 * to focus, or the folder to expand/collapse, or the row to activate). */
export type TreeAction =
  | { type: "focus"; index: number }
  | { type: "expand"; index: number }
  | { type: "collapse"; index: number }
  | { type: "activate"; index: number }
  | { type: "rename"; index: number }
  | { type: "none" }

/** The depth (nesting level) of a row path — the number of `/` separators.
 * Exported so the DOM glue derives descriptors the same way this core reasons
 * about them, never a second, divergent notion of nesting. */
export function treeDepth(path: string): number {
  let n = 0
  for (const ch of path) if (ch === "/") n++
  return n
}

/** The index of `current`'s parent folder header — the nearest earlier row at
 * exactly one shallower depth — or `-1` at the root (nothing shallower before
 * it). */
function parentIndex(rows: TreeRow[], current: number): number {
  const target = rows[current].depth - 1
  for (let i = current - 1; i >= 0; i--) {
    if (rows[i].depth === target) return i
    if (rows[i].depth < target) return -1 // climbed past the parent's level without finding it
  }
  return -1
}

/**
 * Resolve `key` (a `KeyboardEvent.key`) against the visible `rows` with focus on
 * `rows[current]`. Returns the action the glue should perform, or `{type:"none"}`
 * when the key does nothing here (an unrelated key, a move past an end, Right on
 * a note, Left at the root). `current` out of range yields `none`.
 */
export function resolveTreeKey(key: string, rows: TreeRow[], current: number): TreeAction {
  if (current < 0 || current >= rows.length) return { type: "none" }
  const row = rows[current]

  switch (key) {
    case "ArrowDown":
      return current < rows.length - 1 ? { type: "focus", index: current + 1 } : { type: "none" }
    case "ArrowUp":
      return current > 0 ? { type: "focus", index: current - 1 } : { type: "none" }
    case "Home":
      return current === 0 ? { type: "none" } : { type: "focus", index: 0 }
    case "End":
      return current === rows.length - 1 ? { type: "none" } : { type: "focus", index: rows.length - 1 }
    case "ArrowRight": {
      if (row.kind !== "folder") return { type: "none" } // a note has nothing to open into
      if (!row.expanded) return { type: "expand", index: current }
      // Already expanded: descend to the first child, if it has one (the very
      // next row, one level deeper). An expanded-but-empty folder → nothing.
      const next = rows[current + 1]
      return next && next.depth === row.depth + 1 ? { type: "focus", index: current + 1 } : { type: "none" }
    }
    case "ArrowLeft": {
      if (row.kind === "folder" && row.expanded) return { type: "collapse", index: current }
      // A collapsed folder, or a note: step out to the parent folder header.
      const parent = parentIndex(rows, current)
      return parent === -1 ? { type: "none" } : { type: "focus", index: parent }
    }
    case "Enter":
    case " ":
      return { type: "activate", index: current }
    case "F2":
      // Rename the focused row (FEAT-0076); the glue routes to the note- vs
      // folder-rename entry point by the row's kind. Same one-row-at-a-time
      // shape as every other action here.
      return { type: "rename", index: current }
    default:
      return { type: "none" }
  }
}

/** Whether `e`'s key is a printable character that should drive typeahead
 * (M37/FEAT-0077): a single-character `key` pressed with **no** Ctrl/Alt/Cmd
 * modifier. Named keys (`ArrowDown`, `F2`, `Enter`) have multi-character `key`s
 * and are excluded; Space is a single char but `resolveTreeKey` already claims it
 * as `activate`, so it never reaches the typeahead branch that consults this.
 *
 * Every modifier chord is rejected on purpose. Deciding "did this keystroke
 * produce text?" from the modifier flags alone is not possible across platforms
 * — Alt+letter is a menu accelerator on Windows/Linux but composes real text on
 * macOS (Option), and AltGr (text) is indistinguishable from a Ctrl+Alt shortcut
 * because both set ctrlKey+altKey. Rejecting all chords is the only choice that
 * never swallows a shortcut on any platform; the cost is that characters that
 * require a modifier to type (accented/composed letters via Option or AltGr)
 * don't drive typeahead — plain letters do, everywhere, and such notes stay
 * reachable via the arrows or the Ctrl+K switcher. */
export function isTypeaheadKey(e: {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}): boolean {
  return e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey
}

/** The index of the next `labels` entry that starts with `buffer`
 * (case-insensitive), searching from `current + 1` and wrapping through
 * `current` itself, or `-1` when nothing matches (including an empty `buffer` or
 * empty `labels`) — the pure core of tree typeahead (M37/FEAT-0077). Searching
 * after `current` and wrapping is what makes both "jump to the next match" and
 * "repeated same letter cycles through all matches" fall out of one rule;
 * including `current` last means a buffer only the focused row matches keeps
 * focus there rather than reporting no match. */
export function typeaheadMatch(labels: string[], current: number, buffer: string): number {
  if (buffer === "") return -1
  const needle = foldForMatch(buffer)
  for (let i = 1; i <= labels.length; i++) {
    const idx = (current + i) % labels.length
    if (foldForMatch(labels[idx]).startsWith(needle)) return idx
  }
  return -1
}

/** Normalize a string for typeahead comparison (M37/FEAT-0077/AC-10): lowercase
 * and fold accents to their base letter, so typing plain ASCII reaches a note
 * with an accented name (`l` → `łódka`, `a` → `ątek`) — useful because the
 * accented character itself needs an AltGr/Option chord, which typeahead doesn't
 * accept. NFD decomposition + stripping combining marks handles most accents
 * (`ą`→a, `ó`→o, `é`→e, `ż`→z…); `ł` is a distinct letter that does NOT
 * decompose, so it's mapped explicitly. */
export function foldForMatch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/ł/gi, "l")
    .toLowerCase()
}
