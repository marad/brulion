import type { EditorView } from "codemirror"
import { reloadEditorText, setEditorText } from "./editor"
import {
  captureRichEditorState,
  hasRichEditor,
  restoreRichEditorState,
  richDocumentFromState,
  reloadRichEditorSource,
  serializedRichMarkdown,
  setRichEditorSource,
  type RichEditorSnapshot,
} from "./rich-editor"
import type { RichDocument } from "./rich-markdown"

export interface EditorDocumentSnapshot {
  markdown: string
  visible: string
  rich: RichEditorSnapshot | null
}

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
  /** Capture/restore exact transient editor state for failed speculative loads. */
  capture?(): EditorDocumentSnapshot
  restore?(snapshot: EditorDocumentSnapshot): void
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
    capture() {
      return {
        markdown: serializedRichMarkdown(view.state) ?? view.state.doc.toString(),
        visible: view.state.doc.toString(),
        rich: hasRichEditor(view.state) ? captureRichEditorState(view) : null,
      }
    },
    restore(snapshot) {
      if (snapshot.rich && hasRichEditor(view.state)) restoreRichEditorState(view, snapshot.rich)
      else if (view.state.doc.toString() !== snapshot.visible) setEditorText(view, snapshot.markdown)
    },
  }
}
