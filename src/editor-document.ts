import type { EditorView } from "codemirror"
import type { RichDocument } from "./rich-markdown"

export interface EditorDocumentBoundary {
  /** Current raw Markdown; visible text is never returned from the primary path. */
  readMarkdown(): string
  /** Current CodeMirror-visible text, for diagnostics and viewport mapping only. */
  readVisible(): string
  /** Current rich model, or null for a raw editor. */
  readModel(): RichDocument | null
  /** Load a raw Markdown snapshot without making it dirty. */
  loadMarkdown(source: string): void
  /** Reparse a raw Markdown snapshot while preserving mapped view position. */
  reloadMarkdown(source: string): void
}

export function createEditorDocument(_view: EditorView): EditorDocumentBoundary {
  throw new Error("createEditorDocument is not implemented")
}
