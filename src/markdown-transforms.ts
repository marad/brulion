import { type EditorState, type TransactionSpec } from "@codemirror/state"
import { syntaxTree } from "@codemirror/language"
import { type SyntaxNode } from "@lezer/common"

/**
 * The formatting logic, as pure transforms on `(state, selection) →
 * TransactionSpec`. No view, no DOM — so the keyboard shortcuts (FEAT-0007),
 * slash commands (FEAT-0008), and right-click popup (FEAT-0009) all reuse the
 * same unit-tested code instead of re-deriving how to edit the markdown. Every
 * transform writes only plain CommonMark characters (`*`, `**`, `` ` ``, `#`).
 */

export interface InlineMarker {
  /** The literal markup, e.g. `**`, `*`, `` ` ``. */
  marker: string
  /** The Lezer node that this markup produces, used to detect an existing wrap. */
  nodeName: "StrongEmphasis" | "Emphasis" | "InlineCode"
}

export const BOLD: InlineMarker = { marker: "**", nodeName: "StrongEmphasis" }
export const ITALIC: InlineMarker = { marker: "*", nodeName: "Emphasis" }
export const CODE: InlineMarker = { marker: "`", nodeName: "InlineCode" }

/** Mark-child node names whose characters delimit an inline span. */
const INLINE_MARKS = new Set(["EmphasisMark", "CodeMark"])

/** The inner text of an inline node — the slice between its two mark children. */
function innerText(state: EditorState, node: SyntaxNode): string {
  const marks: SyntaxNode[] = []
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (INLINE_MARKS.has(c.name)) marks.push(c)
  }
  const from = marks.length ? marks[0].to : node.from
  const to = marks.length ? marks[marks.length - 1].from : node.to
  return state.doc.sliceString(from, to)
}

/** The innermost `nodeName` node containing `pos`, if any (for a caret toggle). */
function nodeAt(state: EditorState, pos: number, nodeName: string): SyntaxNode | null {
  for (
    let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1);
    n;
    n = n.parent
  ) {
    if (n.name === nodeName) return n
  }
  return null
}

/** All `nodeName` nodes that intersect `[from, to)`, in document order. */
function nodesIn(
  state: EditorState,
  from: number,
  to: number,
  nodeName: string,
): SyntaxNode[] {
  const nodes: SyntaxNode[] = []
  syntaxTree(state).iterate({
    from,
    to,
    enter(n) {
      if (n.name === nodeName) nodes.push(n.node)
    },
  })
  return nodes
}

/** Unwrap each node to its inner text; keep the unwrapped span selected. */
function unwrap(state: EditorState, nodes: SyntaxNode[]): TransactionSpec {
  const changes = nodes.map((n) => ({
    from: n.from,
    to: n.to,
    insert: innerText(state, n),
  }))
  const removed = changes.reduce((sum, c) => sum + (c.to - c.from - c.insert.length), 0)
  return {
    changes,
    selection: { anchor: nodes[0].from, head: nodes[nodes.length - 1].to - removed },
  }
}

/**
 * Toggle an inline marker around the main selection. If any same-type span
 * intersects the selection, all of them are unwrapped (so the result is always
 * valid markdown — never a stray `****` from wrapping over an existing marker);
 * otherwise the selection is wrapped. An empty selection toggles the span at the
 * caret, or inserts an empty marker pair with the caret parked between them.
 * Unwrapping by the parsed structure avoids the `*`-inside-`**` ambiguity a raw
 * character scan would hit.
 */
export function toggleInline(
  state: EditorState,
  { marker, nodeName }: InlineMarker,
): TransactionSpec | null {
  const { from, to } = state.selection.main

  if (from === to) {
    const node = nodeAt(state, from, nodeName)
    if (node) return unwrap(state, [node])
    // Insert the pair, caret in the middle, ready to type.
    return {
      changes: { from, insert: marker + marker },
      selection: { anchor: from + marker.length },
    }
  }

  const nodes = nodesIn(state, from, to, nodeName)
  if (nodes.length) return unwrap(state, nodes)

  const fromLine = state.doc.lineAt(from)
  const toLine = state.doc.lineAt(to)
  if (fromLine.number === toLine.number) {
    // Single line: wrap the selection, keep the same text selected.
    return {
      changes: [
        { from, insert: marker },
        { from: to, insert: marker },
      ],
      selection: { anchor: from + marker.length, head: to + marker.length },
    }
  }

  // Multi-line: wrap each line's selected segment on its own. Wrapping the whole
  // span (`**line1\nline2**`) would straddle block boundaries and is not valid
  // CommonMark — per-line markers keep the file clean (the moat).
  const changes: { from: number; insert: string }[] = []
  for (let n = fromLine.number; n <= toLine.number; n++) {
    const line = state.doc.line(n)
    const segFrom = Math.max(line.from, from)
    const segTo = Math.min(line.to, to)
    if (segTo > segFrom) {
      changes.push({ from: segFrom, insert: marker }, { from: segTo, insert: marker })
    }
  }
  // `null` (not `{}`) when nothing would change, so callers don't dispatch an
  // empty transaction that pollutes the undo history — same contract as the
  // heading transforms.
  return changes.length ? { changes } : null
}

/** The ATX heading level of a line (1–6), or 0 for a plain paragraph. */
export function headingLevelOf(line: string): number {
  const m = /^(#{1,6}) /.exec(line)
  return m ? m[1].length : 0
}

/**
 * Return `line` rewritten to heading `level` (1–6), or to a plain paragraph
 * (`level === 0`). Only the `#` prefix changes; the line's text is preserved.
 */
export function withHeadingLevel(line: string, level: number): string {
  const text = line.replace(/^#{1,6} /, "")
  return level > 0 ? `${"#".repeat(level)} ${text}` : text
}

/** Promote one step toward H1: paragraph → H3 → H2 → H1 (stops at H1). */
export function promotedLevel(level: number): number {
  return level === 0 ? 3 : Math.max(1, level - 1)
}

/** Demote one step toward paragraph: H1 → H2 → H3 → paragraph (stops at 0). */
export function demotedLevel(level: number): number {
  if (level === 0) return 0
  return level >= 3 ? 0 : level + 1
}

/**
 * Build a transaction that sets the caret line's heading to `level`, or `null`
 * if the level is unchanged — so a no-op (promote on H1, demote on a paragraph,
 * set-to-current) issues no transaction and pollutes neither the doc nor undo.
 */
function changeHeading(
  state: EditorState,
  nextLevel: (current: number) => number,
): TransactionSpec | null {
  const line = state.doc.lineAt(state.selection.main.head)
  const level = nextLevel(headingLevelOf(line.text))
  const replaced = withHeadingLevel(line.text, level)
  if (replaced === line.text) return null
  return {
    changes: { from: line.from, to: line.to, insert: replaced },
  }
}

/** Promote the caret line's heading (Ctrl+↑). */
export const promoteHeading = (state: EditorState): TransactionSpec | null =>
  changeHeading(state, promotedLevel)

/** Demote the caret line's heading (Ctrl+↓). */
export const demoteHeading = (state: EditorState): TransactionSpec | null =>
  changeHeading(state, demotedLevel)

/** Set the caret line directly to a heading level (Ctrl+Shift+N / slash / menu). */
export const setHeading =
  (level: number) =>
  (state: EditorState): TransactionSpec | null =>
    changeHeading(state, () => level)

/**
 * The first..last line numbers the range `[from, to)` covers. A selection ending
 * exactly at a line start doesn't really include that line (it stops at the
 * newline before it), so it's excluded — don't touch the unselected next line.
 */
function selectedLineRange(
  state: EditorState,
  from: number,
  to: number,
): { first: number; last: number } {
  const first = state.doc.lineAt(from).number
  const lastLineObj = state.doc.lineAt(to)
  const last =
    to > from && lastLineObj.from === to ? lastLineObj.number - 1 : lastLineObj.number
  return { first, last: Math.max(last, first) }
}

/**
 * Set every line touched by the selection to heading `level` (0 = plain
 * paragraph). For the right-click menu, where a selection may span many lines.
 * Returns `null` when no line actually changes.
 */
export function setHeadingLines(state: EditorState, level: number): TransactionSpec | null {
  const { from, to } = state.selection.main
  const { first: firstLine, last: lastLine } = selectedLineRange(state, from, to)
  const changes: { from: number; to: number; insert: string }[] = []
  for (let n = firstLine; n <= lastLine; n++) {
    const line = state.doc.line(n)
    const replaced = withHeadingLevel(line.text, level)
    if (replaced !== line.text) {
      changes.push({ from: line.from, to: line.to, insert: replaced })
    }
  }
  return changes.length ? { changes } : null
}

/**
 * The marker-character ranges to delete to clear all formatting on every line
 * that `[from, to)` touches: inline marks (bold/italic/inline code) and block
 * prefixes (heading `#`, blockquote `>`, unordered-list `*`/`-`, each with its
 * trailing space). Driven by the parsed structure — not a character scan — so
 * nested marks fully unwrap and a `*` inside `**` is unambiguous. Ordered-list
 * numbers and fenced-code fences are deliberately left intact (see FEAT-0017).
 * Ranges come out in ascending, non-overlapping document order. Exported so the
 * slash command can merge them with its token removal in one transaction.
 */
export function clearFormattingRanges(
  state: EditorState,
  from: number,
  to: number,
): { from: number; to: number }[] {
  const doc = state.doc
  const { first, last } = selectedLineRange(state, from, to)
  const start = doc.line(first).from
  const end = doc.line(last).to

  // A block-prefix marker swallows the single space after it, when present.
  const withTrailingSpace = (mFrom: number, mTo: number) => ({
    from: mFrom,
    to: doc.sliceString(mTo, mTo + 1) === " " ? mTo + 1 : mTo,
  })

  const ranges: { from: number; to: number }[] = []
  syntaxTree(state).iterate({
    from: start,
    to: end,
    enter(node) {
      const n = node.name
      if (n === "EmphasisMark") {
        ranges.push({ from: node.from, to: node.to })
      } else if (n === "CodeMark" && node.node.parent?.name === "InlineCode") {
        ranges.push({ from: node.from, to: node.to })
      } else if (n === "HeaderMark" || n === "QuoteMark") {
        ranges.push(withTrailingSpace(node.from, node.to))
      } else if (n === "ListMark" && node.node.parent?.parent?.name === "BulletList") {
        ranges.push(withTrailingSpace(node.from, node.to))
      }
    },
  })
  return ranges
}

/**
 * Clear all formatting on the lines the main selection touches: unwrap inline
 * marks and strip block prefixes, leaving plain paragraph text. Returns `null`
 * when nothing would change (no marker found), so a no-op clear issues no
 * transaction — the same contract as the heading transforms.
 */
export function clearFormatting(state: EditorState): TransactionSpec | null {
  const { from, to } = state.selection.main
  const ranges = clearFormattingRanges(state, from, to)
  if (!ranges.length) return null
  return { changes: ranges.map((r) => ({ from: r.from, to: r.to })) }
}

/**
 * True when `lineText` is an *empty* list or blockquote line: nothing but the
 * marker(s) (`>`, `*`/`-`/`+`, `1.`/`1)`) and whitespace, no content. Used by the
 * markdown-aware Enter (FEAT-0018) to decide between continuing the construct and
 * exiting it — pressing Enter on such a line removes the marker.
 */
export function isEmptyMarkerLine(lineText: string): boolean {
  return /\S/.test(lineText) && /^[\s>]*(?:[-*+]|\d+[.)])?\s*$/.test(lineText)
}
