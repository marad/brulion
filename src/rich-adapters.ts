import type { EditorView } from "@codemirror/view"
import type { RichDocument } from "./rich-markdown"

export type RichFormatAction =
  | "Bold"
  | "Italic"
  | "Code"
  | "Heading 1"
  | "Heading 2"
  | "Heading 3"
  | "Clear formatting"

export interface RichEditorSelectionRange {
  /** UTF-16 offset in CodeMirror's LF-normalized visible document. */
  from: number
  to: number
}

export interface RichModelSelectionRange {
  /** UTF-16 offset in `RichDocument.visible`, which may retain CRLF. */
  from: number
  to: number
}

/** Apply one visible rich formatting action, or return false without dispatch. */
export function applyRichFormat(_view: EditorView, _action: RichFormatAction): boolean {
  throw new Error("rich adapter stub")
}

/** Remove one exact visible slash token and apply its rich command atomically. */
export function applyRichSlash(
  _view: EditorView,
  _tokenFrom: number,
  _tokenTo: number,
  _command: "/h1" | "/h2" | "/h3" | "/clear",
): boolean {
  throw new Error("rich adapter stub")
}

/** Paste plain text into the current CodeMirror-visible selection. */
export function applyRichPaste(_view: EditorView, _text: string): boolean {
  throw new Error("rich adapter stub")
}

/** Serialize model-visible ranges to an ephemeral Markdown clipboard payload. */
export function serializeRichSelection(
  _document: RichDocument,
  _ranges: readonly RichModelSelectionRange[],
): string {
  throw new Error("rich adapter stub")
}
