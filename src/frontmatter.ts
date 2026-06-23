import { type EditorState, type Extension, StateEffect } from "@codemirror/state"

/** The byte range of a leading frontmatter block: the document start through the
 * end of the closing delimiter line. */
export interface FrontmatterRange {
  from: number
  to: number
}

/**
 * Detect a leading YAML frontmatter block (FEAT-0042). A block is recognised
 * structurally — not via the markdown parser — by the Obsidian/Jekyll/pandoc
 * convention: the document's first line is exactly `---`, closed by a later line
 * that is exactly `---` or `...`. Returns the range from the document start
 * through the end of that closing line, or `null` when there is no leading `---`
 * or no closing delimiter yet (an unclosed block stays raw). Pure: reads the
 * document only, mutates nothing.
 */
export function frontmatterRange(state: EditorState): FrontmatterRange | null {
  void state
  throw new Error("stub")
}

/** Effect that toggles the frontmatter region between collapsed and expanded. */
export const toggleFrontmatter = StateEffect.define<void>()

/**
 * The frontmatter rendering extension: the collapse/expand state field plus its
 * styling. A `StateField` (not a viewport plugin) because the collapsed chip is a
 * block-level, layout-changing decoration, which CodeMirror only accepts from a
 * field. Add it to the editor to render a leading frontmatter block as a discreet,
 * expandable "metadata" region. Decoration only — the document bytes are untouched.
 */
export const frontmatterRendering: Extension = [] // stub — built in Phase 5
