# M47 P5 — signatures

The source-coordinate names in this document are deliberate: a plain
`EditorSelectionRequest` is a visible-editor type, while the rich adapter has
separate source and visible types. `RichDocument` remains the P1–P4 model type.

## `rich-editor.ts`

```ts
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

export interface RichEditorSnapshot {
  document: RichDocument
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

/** Extension that makes a primary CodeMirror view project RichDocument.visible. */
export function richEditorExtension(): Extension

/** Whether this EditorState carries the primary rich model. */
export function hasRichEditor(state: EditorState): boolean

/** Read the sole current rich model, or null for a raw editor. */
export function richDocumentFromState(state: EditorState): RichDocument | null

/** Read serialized Markdown from the rich model, or null for a raw editor. */
export function serializedRichMarkdown(state: EditorState): string | null

/** Apply visible transaction changes to a model before CodeMirror commits them. */
export function applyRichVisibleChanges(
  document: RichDocument,
  changes: readonly RichVisibleChange[],
  interimSelection: RichVisibleSelection,
): RichVisibleChangeResult

/** Import source and commit source/model/visible text as one programmatic load. */
export function setRichEditorSource(view: EditorView, source: string): void

/** Capture and restore exact transient rich state for failed speculative loads. */
export function captureRichEditorState(view: EditorView): RichEditorSnapshot
export function restoreRichEditorState(view: EditorView, snapshot: RichEditorSnapshot): void

/** Re-import external source and map selection and viewport without autosave. */
export function reloadRichEditorSource(view: EditorView, source: string): void

/** Translate visible selection positions into UTF-16 source positions. */
export function richSelectionToSource(
  document: RichDocument,
  selection: RichVisibleSelection,
): RichSourceSelection

/** Translate UTF-16 source positions into visible positions. */
export function richSourceSelectionToVisible(
  document: RichDocument,
  selection: RichVisibleSelection,
): RichVisibleSelection

/** Translate CodeMirror's LF-normalized positions to source coordinates. */
export function richEditorSelectionToSource(
  document: RichDocument,
  selection: RichVisibleSelection,
): RichSourceSelection

/** Translate source-map visible positions back to CodeMirror positions. */
export function richSourceSelectionToEditor(
  document: RichDocument,
  selection: RichVisibleSelection,
): RichVisibleSelection

/** Map a visible selection and viewport through a source reload. */
export function mapRichReload(
  oldDocument: RichDocument,
  nextDocument: RichDocument,
  selection: RichVisibleSelection,
  viewport: RichViewportAnchor,
): RichReloadMapping
```

`richSourceSelectionToVisible` maps hidden delimiter/source positions to the
nearest visible boundary deterministically; it does not claim that hidden source
characters are normal caret stops. `richEditorSelectionToSource` and
`richSourceSelectionToEditor` additionally account for CodeMirror's LF-only
line-separator storage while the source/model keeps CRLF bytes. Explicit
source-island mutation remains a separate P4/model operation and is not
silently synthesized by this mapping.

## `editor-document.ts`

```ts
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
  /** Optional exact snapshot hooks for controller rollback of speculative loads. */
  capture?(): EditorDocumentSnapshot
  restore?(snapshot: EditorDocumentSnapshot): void
}

/** Bind source operations to a rich or raw EditorView. */
export function createEditorDocument(view: EditorView): EditorDocumentBoundary
```

## Existing editor surface changes

```ts
export interface EditorOptions {
  rich?: boolean
  onChange?: () => void
  onSave?: () => void
  // existing link callbacks remain
}

export function getEditorSelection(view: EditorView): EditorSelection
export function setEditorSelection(view: EditorView, selection: EditorSelectionRequest): void
export function setEditorText(view: EditorView, text: string): void
export function reloadEditorText(view: EditorView, text: string): void
```

For a rich view, `getEditorSelection` returns `RichSourceSelection`-equivalent
serialized Markdown and UTF-16 source offsets (the M46 public contract), while
`setEditorSelection` accepts source offsets and maps them through the current
model. Raw views retain their current direct `state.doc` behavior.

## Existing controller boundary changes

```ts
export interface NoteControllerOptions {
  editorDocument?: EditorDocumentBoundary
  onConflict?: (versions: ConflictVersions) => void
  // existing callbacks and debounceMs remain
}

export function createNoteController(
  view: EditorView,
  opts?: NoteControllerOptions,
): NoteController
```

The controller's relevant internal source contract is explicit even though its
public lifecycle methods remain stable:

```ts
interface SerializedSaveSnapshot {
  markdown: string
  knownLastModified: number | null
}

function readSerializedSaveSnapshot(): SerializedSaveSnapshot
function markSerializedChange(): void
function loadSerializedMarkdown(source: string): void
function reloadSerializedMarkdown(source: string): void
```

Every `saveNote` call receives `SerializedSaveSnapshot.markdown`; visible
CodeMirror text is never a storage payload.

## Error contract

- Invalid visible/source positions continue to raise `RangeError` at the editor
  boundary before dispatch.
- Invalid/stale rich model edits reject the candidate and retain the previous
  state field and visible document.
- Source loads/reloads are synchronous CodeMirror dispatches; if import/mapping
  fails, the prior state remains unchanged and the error propagates.
- A source coordinate inside hidden syntax maps to a visible boundary for
  selection reads/writes; unsafe source edits are rejected by the explicit P4
  source-edit functions, not by selection mapping.
- Filesystem errors and stale mtimes retain the controller's existing async
  `AddNoteResult`/conflict behavior.
