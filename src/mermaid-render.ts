/**
 * Mermaid block rendering (FEAT-0056). A CodeMirror extension that replaces a closed
 * ```` ```mermaid ```` fenced block with its rendered diagram, leaving the document
 * bytes untouched. The raw source is revealed when the selection is inside the block.
 * Rendering is async and lazy (see {@link ./mermaid-engine}).
 */
import { type EditorState, type Extension } from "@codemirror/state"
import { type DecorationSet, WidgetType } from "@codemirror/view"

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
 * syntax tree, returns the blocks in document order. An unterminated fence or a
 * different info string is not returned.
 */
export function findMermaidBlocks(state: EditorState): MermaidBlock[] {
  void state
  throw new Error("stub")
}

/**
 * The decoration set for the current state: a block `Decoration.replace` carrying a
 * {@link MermaidWidget} for each block whose range does NOT overlap the selection;
 * blocks overlapping the selection are omitted so their raw source stays visible and
 * editable. Pure (constructs widgets but does not render them).
 */
export function mermaidDecorations(state: EditorState): DecorationSet {
  void state
  throw new Error("stub")
}

/**
 * Block-replace widget that renders its `source` as a Mermaid diagram. `toDOM`
 * returns a container synchronously and fills it asynchronously with the SVG, or with
 * an in-place error box if the diagram fails to render. `eq` compares the source only
 * (equal source ⇒ identical diagram ⇒ DOM reuse is safe, async render skipped).
 */
export class MermaidWidget extends WidgetType {
  constructor(readonly source: string) {
    super()
  }

  /** Equal iff the diagram source is identical. */
  eq(other: MermaidWidget): boolean {
    void other
    throw new Error("stub")
  }

  /** A container, filled asynchronously with the diagram SVG or an error box. */
  toDOM(): HTMLElement {
    throw new Error("stub")
  }

  /** Mark unmounted so a late-resolving render is discarded. */
  destroy(_dom: HTMLElement): void {
    throw new Error("stub")
  }

  /** Let clicks/selection through to the editor (so the block can be revealed). */
  ignoreEvent(): boolean {
    throw new Error("stub")
  }
}

/**
 * The editor extension: a `StateField<DecorationSet>` (block decorations must come
 * from a field) rebuilt on `docChanged || selectionSet`, plus a base theme. Register
 * after `markdownRendering` in `editor.ts`.
 */
export const mermaidRendering: Extension = []
