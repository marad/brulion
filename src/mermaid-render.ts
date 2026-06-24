/**
 * Mermaid block rendering (FEAT-0056). A CodeMirror extension that replaces a closed
 * ```` ```mermaid ```` fenced block with its rendered diagram, leaving the document
 * bytes untouched. The raw source is revealed when the selection is inside the block.
 * Rendering is async and lazy (see {@link ./mermaid-engine}).
 */
import {
  type EditorState,
  type Extension,
  RangeSetBuilder,
  StateField,
} from "@codemirror/state"
import { type DecorationSet, Decoration, EditorView, WidgetType } from "@codemirror/view"
import { syntaxTree } from "@codemirror/language"
import { renderMermaid } from "./mermaid-engine"

/**
 * A closed ```` ```mermaid ```` fenced block: the document offsets of the whole block
 * (fence line to fence line, inclusive) and the diagram `source` with the fence lines
 * stripped.
 */
export interface MermaidBlock {
  from: number
  to: number
  source: string
}

/**
 * Find every closed ```` ```mermaid ```` fenced block in the document. Pure: reads the
 * syntax tree, returns the blocks in document order. An unterminated fence (fewer than
 * two fence marks) or a different info string is not returned.
 */
export function findMermaidBlocks(state: EditorState): MermaidBlock[] {
  const doc = state.doc
  const out: MermaidBlock[] = []
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "FencedCode") return
      let marks = 0
      let info: { from: number; to: number } | null = null
      let text: { from: number; to: number } | null = null
      for (let c = node.node.firstChild; c; c = c.nextSibling) {
        if (c.name === "CodeMark") marks++
        else if (c.name === "CodeInfo") info = { from: c.from, to: c.to }
        else if (c.name === "CodeText") text = { from: c.from, to: c.to }
      }
      if (marks < 2) return // unterminated — only a closed block renders
      const lang = info ? doc.sliceString(info.from, info.to).trim().toLowerCase() : ""
      if (lang !== "mermaid") return
      out.push({
        from: node.from,
        to: node.to,
        source: text ? doc.sliceString(text.from, text.to) : "",
      })
    },
  })
  return out
}

/**
 * True if any selection range overlaps the block interior — then the block is
 * revealed for editing. Strict (`<`/`>`, the same convention as `markdown-render.ts`):
 * a caret resting exactly on a boundary (e.g. position 0 for a block at the very start
 * of the document) does NOT reveal, so a note that opens on a diagram still renders it.
 */
function selectionTouches(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((r) => r.from < to && r.to > from)
}

/**
 * The decoration set for the current state: a block `Decoration.replace` carrying a
 * {@link MermaidWidget} for each block whose range does NOT overlap the selection;
 * blocks overlapping the selection are omitted so their raw source stays visible and
 * editable. Pure (constructs widgets but does not render them).
 */
export function mermaidDecorations(state: EditorState): DecorationSet {
  // Note: `markdown-render.ts`'s block field also decorates this same range (it styles
  // any closed fenced block as a code box). A block `replace` here hides those lines,
  // so the two coexist; the live coexistence is guarded by e2e (a render that threw a
  // decoration RangeError would surface as a page error there).
  const builder = new RangeSetBuilder<Decoration>()
  for (const block of findMermaidBlocks(state)) {
    if (selectionTouches(state, block.from, block.to)) continue
    builder.add(
      block.from,
      block.to,
      Decoration.replace({ widget: new MermaidWidget(block.source), block: true }),
    )
  }
  return builder.finish()
}

/**
 * Block-replace widget that renders its `source` as a Mermaid diagram. `toDOM`
 * returns a container synchronously and fills it asynchronously with the SVG, or with
 * an in-place error box if the diagram fails to render. `eq` compares the source only
 * (equal source ⇒ identical diagram ⇒ DOM reuse is safe, async render skipped).
 */
export class MermaidWidget extends WidgetType {
  // Per-instance liveness: a late-resolving render for a removed widget is dropped
  // (no write to detached DOM). Set false in destroy().
  private mounted = false

  constructor(readonly source: string) {
    super()
  }

  /** Equal iff the diagram source is identical. */
  eq(other: MermaidWidget): boolean {
    return other.source === this.source
  }

  /** A container, filled asynchronously with the diagram SVG or an error box. */
  toDOM(): HTMLElement {
    const container = document.createElement("div")
    container.className = "cm-mermaid"
    this.mounted = true
    if (!this.source.trim()) {
      container.classList.add("cm-mermaid-empty")
      container.textContent = "Empty diagram"
      return container
    }
    void renderMermaid(this.source).then(
      (svg) => {
        if (this.mounted) container.innerHTML = svg
      },
      (err: unknown) => {
        if (!this.mounted) return
        container.classList.add("cm-mermaid-error")
        container.textContent = `Mermaid error: ${err instanceof Error ? err.message : String(err)}`
      },
    )
    return container
  }

  /** Mark unmounted so a late-resolving render is discarded. */
  destroy(): void {
    this.mounted = false
  }

  /** Let clicks/selection through to the editor (so the block can be revealed). */
  ignoreEvent(): boolean {
    return false
  }
}

// Block decorations must come from a StateField (not a view plugin). Rebuild on a
// document change (blocks may appear/disappear/change) or a selection change (reveal
// the block the caret entered / re-render the one it left); otherwise map the set
// through the (empty) changes.
const mermaidField = StateField.define<DecorationSet>({
  create: (state) => mermaidDecorations(state),
  update: (value, tr) => {
    if (tr.docChanged || tr.selection) return mermaidDecorations(tr.state)
    return value.map(tr.changes)
  },
  provide: (field) => EditorView.decorations.from(field),
})

// Clicking a rendered diagram should reveal its source for editing. A block-replace
// widget is atomic, so a plain click lands the caret on a block boundary (which, by
// the strict overlap rule, does NOT reveal). Instead, move the caret just inside the
// block so the field reveals the raw source on the next rebuild.
const mermaidClick = EditorView.domEventHandlers({
  mousedown(event, view) {
    const container = (event.target as HTMLElement).closest(".cm-mermaid")
    if (!container) return false
    const pos = view.posAtDOM(container)
    const block = findMermaidBlocks(view.state).find((b) => pos >= b.from && pos <= b.to)
    if (!block) return false
    event.preventDefault()
    view.dispatch({ selection: { anchor: Math.min(block.from + 1, block.to) } })
    view.focus()
    return true
  },
})

/**
 * The editor extension: the block-decoration field plus the click-to-reveal handler.
 * Register after `markdownRendering` in `editor.ts`. Visual styling lives in
 * `styles.css` (`.cm-mermaid*`).
 */
export const mermaidRendering: Extension = [mermaidField, mermaidClick]
