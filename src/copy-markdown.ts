import { type EditorState, type Extension } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { syntaxTree } from "@codemirror/language"
import { type SyntaxNode } from "@lezer/common"
import { frontmatterRange } from "./frontmatter"

/**
 * Copy fidelity (FEAT-0045). CodeMirror's default copy hands the clipboard the raw
 * `sliceDoc(from, to)`. Because markdown markup is rendered as atomic, hidden runs,
 * a selection's boundaries snap *past* a leading `# `/`> `/`* ` or *inside* a
 * `**…**`/`` `…` `` span, so the slice drops those markers. This module re-serializes
 * the selection, repairing only the two boundaries, so the clipboard holds
 * well-formed markdown that reproduces the visible formatting — never more than the
 * selection plus the markers needed to make it valid. Pure core; thin DOM shell.
 */

/** A selected range — the structural subset of CodeMirror's `SelectionRange` the
 * serializer reads. */
export interface SelRange {
  from: number
  to: number
}

/** Inline span node names whose dropped delimiters we synthesize. */
const INLINE_SPANS = new Set(["StrongEmphasis", "Emphasis", "InlineCode"])

/** Mark-child node names that delimit an inline span (`**`/`*`/`` ` ``). */
const INLINE_MARKS = new Set(["EmphasisMark", "CodeMark"])

/**
 * The leading block-marker run that the renderer collapses: nested blockquote `>`
 * runs, then an optional ATX heading (`#…# `) or unordered-list (`*`/`- `) marker —
 * each with its trailing space. Keyed off the line text (not `QuoteMark`/`HeaderMark`
 * nodes, which the grammar drops on some lines and which exclude the trailing space),
 * so it mirrors exactly what markdown-render hides. Always matches (everything is
 * optional); an empty match (`""`) means a plain paragraph — nothing to repair.
 */
const LINE_MARKER_RE = /^((?:> ?)*)(?:#{1,6} |[*-] )?/

/** The first and last mark children of an inline span, or null if it has none. */
function inlineMarks(node: SyntaxNode): { open: SyntaxNode; close: SyntaxNode } | null {
  let open: SyntaxNode | null = null
  let close: SyntaxNode | null = null
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (INLINE_MARKS.has(c.name)) {
      if (!open) open = c
      close = c
    }
  }
  return open && close ? { open, close } : null
}

/**
 * The inline delimiters missing at boundary `pos`, read verbatim from the document.
 * `side: "open"` → opening delimiters of spans whose content holds `pos` *past* their
 * open mark (`open.to <= pos < close.from`), ordered **outermost-first** to reopen at
 * the selection start. `side: "close"` → closing delimiters of spans whose content
 * holds `pos` *before* their close mark (`open.to < pos <= close.from`), ordered
 * **innermost-first** to close at the selection end. Total: `[]` when no span applies.
 */
function inlineDelimiters(
  state: EditorState,
  pos: number,
  side: "open" | "close",
): string[] {
  const doc = state.doc
  const out: string[] = []
  // Ancestor walk from `pos` yields innermost-first. The bias picks the containing
  // span when `pos` sits exactly at a content edge: look forward for the open side,
  // backward for the close side.
  for (
    let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, side === "open" ? 1 : -1);
    n;
    n = n.parent
  ) {
    if (!INLINE_SPANS.has(n.name)) continue
    const marks = inlineMarks(n)
    if (!marks) continue
    if (side === "open") {
      if (marks.open.to <= pos && pos < marks.close.from) {
        out.push(doc.sliceString(marks.open.from, marks.open.to))
      }
    } else if (marks.open.to < pos && pos <= marks.close.from) {
      out.push(doc.sliceString(marks.close.from, marks.close.to))
    }
  }
  return side === "open" ? out.reverse() : out
}

/**
 * True when the line starting at `lineStart` is one of the block constructs the
 * renderer actually hides a leading marker for: an ATX heading, a blockquote, or an
 * unordered-list item. Confirmed via the syntax tree so a *text-only* match can't
 * misfire on a code-block line (a literal `# comment` inside a fence is `CodeText`,
 * not a heading, and the renderer hides nothing there). A fenced/indented code
 * container short-circuits to false.
 */
function lineHasHiddenMarker(state: EditorState, lineStart: number): boolean {
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(lineStart, 1); n; n = n.parent) {
    if (n.name === "FencedCode" || n.name === "CodeBlock") return false
    if (n.name.startsWith("ATXHeading") || n.name === "Blockquote") return true
    if (n.name === "ListItem" && n.parent?.name === "BulletList") return true
  }
  return false
}

/**
 * The leading block-marker run to prepend for the first selected line, read verbatim,
 * or `""`. Returned only when the line is genuinely a hidden-marker construct (per
 * the syntax tree) AND the selection starts at or past the marker run
 * (`from - line.from >= run.length`) — so a plain paragraph, a line selected from its
 * very start, a code-block line, or an expanded frontmatter line repairs nothing.
 */
function lineMarkerPrefix(state: EditorState, from: number): string {
  const line = state.doc.lineAt(from)
  // Frontmatter is left raw by the renderer (FEAT-0042) — but the markdown parser,
  // ignorant of frontmatter, still parses a `- tag` line there as a list item. Skip
  // the whole block so its visible markers are never pulled in.
  const fm = frontmatterRange(state)
  if (fm && line.from < fm.to && line.to > fm.from) return ""
  if (!lineHasHiddenMarker(state, line.from)) return ""
  const run = LINE_MARKER_RE.exec(line.text)?.[0] ?? ""
  return run.length > 0 && from - line.from >= run.length ? run : ""
}

/**
 * The clipboard markdown for a selection. Each range becomes
 * `prefix + sliceDoc(from, to) + suffix` with the boundary repairs above; ranges are
 * joined by the document line separator (CodeMirror's own multi-range convention).
 * Pure & total: an empty range contributes `""`.
 */
export function serializeCopy(state: EditorState, ranges: readonly SelRange[]): string {
  return ranges
    .filter(({ from, to }) => from !== to) // skip empty ranges (CodeMirror's own copy does too)
    .map(({ from, to }) => {
      const prefix =
        lineMarkerPrefix(state, from) + inlineDelimiters(state, from, "open").join("")
      const suffix = inlineDelimiters(state, to, "close").join("")
      return prefix + state.sliceDoc(from, to) + suffix
    })
    .join(state.lineBreak)
}

/** Shared copy/cut logic: re-serialize the selection onto the clipboard, and on a
 * cut delete exactly the selected ranges (never the synthesized markers, which lie
 * outside the selection). Falls through (returns false → CodeMirror's default) on an
 * empty selection or when `clipboardData` is unavailable (broken-clipboard fallback). */
function handleCopyCut(event: ClipboardEvent, view: EditorView, isCut: boolean): boolean {
  const { state } = view
  const ranges = state.selection.ranges
  if (ranges.every((r) => r.empty)) return false
  const data = event.clipboardData
  if (!data) return false
  data.clearData()
  data.setData("text/plain", serializeCopy(state, ranges))
  if (isCut && !state.readOnly) {
    view.dispatch({
      changes: ranges.map((r) => ({ from: r.from, to: r.to })),
      scrollIntoView: true,
      userEvent: "delete.cut",
    })
  }
  event.preventDefault()
  return true
}

/**
 * The editor extension: `copy`/`cut` DOM handlers that put the re-serialized markdown
 * on the clipboard and, on cut, delete the selected ranges. Runs before CodeMirror's
 * built-in copy/cut (plugin handlers fire first; returning true suppresses the
 * built-in), and falls through on an empty selection or a broken clipboard.
 */
export const copyMarkdown: Extension = EditorView.domEventHandlers({
  copy: (event, view) => handleCopyCut(event, view, false),
  cut: (event, view) => handleCopyCut(event, view, true),
})
