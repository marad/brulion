import type { EditorView } from "codemirror"
import { reloadEditorText, setEditorText } from "./editor"
import {
  hasRichEditor,
  richDocumentFromState,
  reloadRichEditorSource,
  serializedRichMarkdown,
  setRichEditorSource,
} from "./rich-editor"
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

export function createEditorDocument(view: EditorView): EditorDocumentBoundary {
  return {
    readMarkdown() {
      return serializedRichMarkdown(view.state) ?? view.state.doc.toString()
    },
    readVisible() {
      return view.state.doc.toString()
    },
    readModel() {
      return richDocumentFromState(view.state)
    },
    loadMarkdown(source) {
      if (hasRichEditor(view.state)) setRichEditorSource(view, source)
      else setEditorText(view, source)
    },
    reloadMarkdown(source) {
      if (hasRichEditor(view.state)) reloadRichEditorSource(view, source)
      else reloadEditorText(view, source)
    },
  }
}
