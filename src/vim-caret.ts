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

/**
 * The end of the run of hidden markup that begins a line — the first position with
 * any *visible* content before it. A caret may not rest anywhere in
 * `[lineFrom, leadingHiddenEnd)`: those positions are all visually collapsed with
 * the first visible glyph (the markup is zero-width), so a line-start motion (`0`,
 * `^`, `I`) must land here, not before the hidden marker (else typing inserts ahead
 * of it — `foo# test` instead of `# foo test`). Walks the hidden `spans` from
 * `lineFrom`, chaining through adjacent runs (e.g. nested `> > `). Pure.
 */
export function leadingHiddenEnd(lineFrom: number, spans: Span[]): number {
  let end = lineFrom
  let grew = true
  while (grew) {
    grew = false
    for (const s of spans) {
      if (s.from <= end && s.to > end) {
        end = s.to
        grew = true
      }
    }
  }
  return end
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
 * Stop the caret resting inside — or before — hidden markup (FEAT-0032). The
 * default caret is already kept out of atomic ranges by CodeMirror's own motions,
 * but the Vim layer moves by raw character offset and ignores them — so this filter
 * post-corrects any selection-setting transaction whose endpoints land where the
 * caret shouldn't be:
 *   - strictly inside a hidden run → snap to the nearer edge (by motion direction);
 *   - anywhere within a line's leading hidden run (incl. the line-start edge) →
 *     snap forward to the first visible character, so `0`/`^`/`I` land past the
 *     marker rather than before it.
 * It lives in the Vim compartment (wired in editor.ts) and so is only installed
 * while Vim is on; off-Vim it would be a pure per-keystroke no-op.
 *
 * Skips transactions that change the document (Vim motions don't; staying off the
 * edit path avoids re-mapping the appended selection) and pointer selections (a
 * click must still place the caret inside a link to reveal its markup — FEAT-0026).
 */
export const vimCaretGuard: Extension = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection || tr.docChanged || tr.isUserEvent("select.pointer")) return tr

  const snap = (pos: number, prev: number): number => {
    const lineFrom = tr.state.doc.lineAt(pos).from
    const spans = hiddenSpansOnLine(tr.state, pos)
    const lead = leadingHiddenEnd(lineFrom, spans)
    if (pos < lead) return lead // before/within the line's hidden prefix
    return snapOutOfSpans(pos, prev, spans)
  }

  const prev = tr.startState.selection
  let changed = false
  const ranges = tr.newSelection.ranges.map((r, i) => {
    const p = prev.ranges[i] ?? prev.main
    const head = snap(r.head, p.head)
    // A collapsed caret (the common per-keystroke case) reuses the head result.
    const anchor = r.anchor === r.head ? head : snap(r.anchor, p.anchor)
    if (anchor !== r.anchor || head !== r.head) changed = true
    return EditorSelection.range(anchor, head)
  })

  return changed
    ? [tr, { selection: EditorSelection.create(ranges, tr.newSelection.mainIndex) }]
    : tr
})
