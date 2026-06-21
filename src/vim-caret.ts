import { EditorSelection, EditorState, type Extension } from "@codemirror/state"
import { blockSyntaxRanges, markdownSyntaxRanges } from "./markdown-render"

/** A run of hidden markup the caret must not rest inside (a `# `/`> `/`* ` run). */
export interface Span {
  from: number
  to: number
}

/**
 * Keep a caret endpoint out of a hidden markup run (FEAT-0032). If `pos` falls
 * **strictly** inside one of `spans`, snap it to an edge: the run's end when the
 * motion advanced (`pos >= prev`), its start when it retreated. A position on an
 * edge or outside every span is returned unchanged. Pure — the testable core of
 * the Vim caret guard.
 */
export function snapOutOfSpans(pos: number, prev: number, spans: Span[]): number {
  for (const s of spans) {
    if (pos > s.from && pos < s.to) return pos >= prev ? s.to : s.from
  }
  return pos
}

/** The hidden markup runs on the line containing `pos` — exactly the runs the
 * renderer hides and makes atomic (inline/heading marks, block marks, and the
 * list-marker runs). Scoped to one line so the lookup stays cheap. */
function hiddenSpansOnLine(state: EditorState, pos: number): Span[] {
  const line = state.doc.lineAt(pos)
  const inline = markdownSyntaxRanges(state, line.from, line.to)
  const block = blockSyntaxRanges(state, line.from, line.to)
  return [
    ...inline.hidden,
    ...block.hidden,
    ...block.bullets.map((b) => ({ from: b.from, to: b.to })),
  ]
}

/**
 * Stop the caret resting inside hidden markup (FEAT-0032). The default caret is
 * already kept out of atomic ranges by CodeMirror's own motions, but the Vim layer
 * moves by raw character offset and ignores them — so this filter post-corrects
 * any selection-setting transaction whose endpoints land strictly inside a hidden
 * run, snapping them to the nearest edge. It lives in the Vim compartment (wired in
 * editor.ts) and so is only installed while Vim is on; off-Vim it would be a pure
 * per-keystroke no-op.
 *
 * Skips transactions that change the document (Vim motions don't; staying off the
 * edit path avoids re-mapping the appended selection) and pointer selections (a
 * click must still place the caret inside a link to reveal its markup — FEAT-0026).
 */
export const vimCaretGuard: Extension = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection || tr.docChanged || tr.isUserEvent("select.pointer")) return tr

  const prev = tr.startState.selection
  let changed = false
  const ranges = tr.newSelection.ranges.map((r, i) => {
    const p = prev.ranges[i] ?? prev.main
    const headSpans = hiddenSpansOnLine(tr.state, r.head)
    // A collapsed caret (the common per-keystroke case) shares one line scan.
    const anchorSpans = r.anchor === r.head ? headSpans : hiddenSpansOnLine(tr.state, r.anchor)
    const anchor = snapOutOfSpans(r.anchor, p.anchor, anchorSpans)
    const head = snapOutOfSpans(r.head, p.head, headSpans)
    if (anchor !== r.anchor || head !== r.head) changed = true
    return EditorSelection.range(anchor, head)
  })

  return changed
    ? [tr, { selection: EditorSelection.create(ranges, tr.newSelection.mainIndex) }]
    : tr
})
