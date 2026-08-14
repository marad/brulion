import type { EditorView } from "codemirror"
import type { EditorState, Extension } from "@codemirror/state"
import type { RichDocument } from "./rich-markdown"

export interface RichVisibleSelection {
  anchor: number
  head: number
}

export interface RichSourceSelection extends RichVisibleSelection {
  text: string
}

export interface RichViewportAnchor {
  /** UTF-16 position in the visible CodeMirror projection. */
  visiblePosition: number
}

export interface RichReloadMapping {
  selection: RichVisibleSelection
  viewport: RichViewportAnchor
}

export interface RichVisibleChange {
  /** Positions in the pre-transaction visible projection. */
  from: number
  to: number
  insert: string
}

export interface RichVisibleChangeResult {
  document: RichDocument
  /** Selection positions in `document.visible`. */
  selection: RichVisibleSelection
}

export function richEditorExtension(): Extension {
  throw new Error("richEditorExtension is not implemented")
}

export function hasRichEditor(_state: EditorState): boolean {
  throw new Error("hasRichEditor is not implemented")
}

export function richDocumentFromState(_state: EditorState): RichDocument | null {
  throw new Error("richDocumentFromState is not implemented")
}

export function serializedRichMarkdown(_state: EditorState): string | null {
  throw new Error("serializedRichMarkdown is not implemented")
}

export function applyRichVisibleChanges(
  _document: RichDocument,
  _changes: readonly RichVisibleChange[],
  _interimSelection: RichVisibleSelection,
): RichVisibleChangeResult {
  throw new Error("applyRichVisibleChanges is not implemented")
}

export function setRichEditorSource(_view: EditorView, _source: string): void {
  throw new Error("setRichEditorSource is not implemented")
}

export function reloadRichEditorSource(_view: EditorView, _source: string): void {
  throw new Error("reloadRichEditorSource is not implemented")
}

export function richSelectionToSource(
  _document: RichDocument,
  _selection: RichVisibleSelection,
): RichSourceSelection {
  throw new Error("richSelectionToSource is not implemented")
}

export function richSourceSelectionToVisible(
  _document: RichDocument,
  _selection: RichVisibleSelection,
): RichVisibleSelection {
  throw new Error("richSourceSelectionToVisible is not implemented")
}

export function mapRichReload(
  _oldDocument: RichDocument,
  _nextDocument: RichDocument,
  _selection: RichVisibleSelection,
  _viewport: RichViewportAnchor,
): RichReloadMapping {
  throw new Error("mapRichReload is not implemented")
}
