# M47 P5 — signature-fit and implementation self-review

## Cold-context traces

### 1. Rich note load

`readNote(dir, path): Promise<NoteContent>` returns `{content, lastModified}` →
`NoteController.loadSerializedMarkdown(source)` calls
`EditorDocumentBoundary.loadMarkdown(source): void` → rich facade calls
`setRichEditorSource(view, source): void` → `richEditorExtension` imports a
`RichDocument` and commits visible text plus the state-field effect → controller
records `savedMarkdown = source` and `dirty = false`. A later
`readSerializedSaveSnapshot(): SerializedSaveSnapshot` returns the model's
`serializedRichMarkdown(state)` and current `knownLastModified` →
`saveNote(dir, path, markdown, knownLastModified)`.

No layer reparses or serializes a second time. The facade is a dispatch/read
adapter, while the state field is the only model owner.

### 2. Typed `**hello** ` conversion

CodeMirror creates one visible transaction with `RichVisibleChange[]` →
`richEditorExtension`'s transaction filter calls
`applyRichVisibleChanges(document, changes, interimSelection)` → the P2 model
returns a `RichVisibleChangeResult` whose source is `**hello** ` and visible
projection is `hello ` → the filter commits a replacement diff plus one model
state effect → the existing `EditorOptions.onChange(): void` fires once → the
controller calls `readMarkdown(): string` and compares it to `savedMarkdown`.

The callback carries no text, intentionally: the source read must happen after
the final model transaction, not from an interim CodeMirror document.

### 3. External refresh with position

`checkDisk`/poll sees mtime delta → controller confirms live `dirty === false`,
`conflict === false`, and `savePromise === null` → `readNote` returns new raw
source → `EditorDocumentBoundary.reloadMarkdown(source): void` calls
`reloadRichEditorSource(view, source)` → `mapRichReload(oldDocument,
nextDocument, visibleSelection, viewportAnchor)` returns mapped visible positions
→ one `ProgrammaticLoad` transaction commits visible diff and new model →
controller updates `lastModified`, `savedMarkdown`, and cache only after the
reload returns.

The viewport payload is `RichViewportAnchor.visiblePosition`; the helper reads
CodeMirror's current top position before calling the pure mapping function.

### 4. Raw extension source selection

The main extension adapter calls `EditorDocumentBoundary.readMarkdown()` and
`getEditorSelection(view)`, which for a rich state invokes
`richSelectionToSource(document, {anchor, head})` and returns source text sliced
from the serialized source → extension receives UTF-16 source coordinates. A
source request reaches `setEditorSelection(view, request)`, which invokes
`richSourceSelectionToVisible(document, request)` and dispatches only the
visible selection. A request at hidden Markdown syntax maps to the nearest
visible boundary; it does not turn delimiters into caret text.

## Findings and dispositions

The first signature-fit pass found that the draft signatures did not declare a
viewport payload, used ambiguous source/visible coordinate names, and hid the
visible-change and serialized-save contracts behind opaque prose. The signatures
were regenerated rather than patched: `RichVisibleSelection`,
`RichSourceSelection`, `RichViewportAnchor`, `RichReloadMapping`,
`RichVisibleChangeResult`, and `SerializedSaveSnapshot` now name those payloads.
The raw-source mapping explicitly maps hidden positions to visible boundaries;
unsafe source mutation remains the P4 operation's responsibility.

## Self-Review

- **Reconsider:** A callback carrying serialized text was considered and
  rejected. It would allow callers to retain a stale source payload; a zero-arg
  change callback forces the controller to read the current state boundary after
  the transaction. A facade cache was also rejected; source is queried from the
  state field on every read.
- **Simplify:** `EditorDocumentBoundary` deliberately contains only source/model
  reads and load/reload. Selection mapping stays in `editor.ts`/`rich-editor.ts`
  because the controller has no selection responsibility. The internal save
  snapshot is one string plus one mtime, not a second document object.
- **Performance:** The change filter handles the CodeMirror transaction once;
  reload maps one selection and one viewport anchor, and no filesystem call can
  occur from the editor filter. The only async retry remains the controller's
  existing post-mutation fallback behavior.
- **Residual uncertainty:** P6 still must adapt clipboard/commands/Vim to rich
  visible selections; P5's source selection mapping is intentionally the narrow
  M46 raw API bridge, not a general source-edit UI.
