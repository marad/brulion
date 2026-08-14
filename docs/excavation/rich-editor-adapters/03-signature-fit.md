# M47 P6 — signature-fit review

Cold-context review was run against `01-architecture.md`, `02-signatures.md`,
`src/rich-adapters.ts`, and `src/rich-render.ts` before bodies existed.

## Trace 1 — visible Bold action

1. `SelectionToolbar` receives `EditorView.state.selection.main` as CodeMirror
   LF offsets.
2. `applyRichFormat(view, "Bold")` reads the `RichDocument` from the state
   field and converts the editor range with `richEditorRangeToModel`.
3. The pure operation `toggleInlineMark(document, model.from, model.to,
   "bold")` returns `{ document, anchor, head }` in model-visible coordinates.
4. `dispatchRichDocumentChange(view, document, selection)` converts the model
   selection back to CodeMirror LF offsets and commits one state effect plus one
   visible diff.

No source coordinate is unpacked/repacked in this trace. The failure owner is the
model boundary: `null` means the toolbar returns false and never dispatches.

## Trace 2 — partial copy in a CRLF note

1. `copy-markdown` receives a `ClipboardEvent` and the view's CodeMirror
   `SelectionRange` (LF offsets).
2. The DOM shell converts each range with `richEditorRangeToModel`.
3. `serializeRichSelection(document, modelRanges)` walks model-visible ranges,
   uses source spans/delimiters, and returns an ephemeral Markdown string.
4. The shell writes only `text/plain`, prevents the browser default, and does not
   mutate the model.

The conversion is explicit at the shell boundary, so CRLF is not passed to a
CodeMirror-coordinate serializer. Missing clipboard data is owned by the shell
and returns false; malformed model ranges contribute no text and cannot cause a
partial model edit.

## Trace 3 — paste of `**word** `

1. Rich paste handler reads `text/plain`; HTML is ignored.
2. `applyRichPaste(view, text)` reads the current CodeMirror selection and builds
   one visible replacement candidate.
3. The candidate is flushed at the paste boundary before dispatch, so the model
   contains the bold span while the visible projection contains `word `.
4. The dispatcher commits one history transaction; the controller later reads
   serialized Markdown through its existing facade.

The paste helper accepts only current selection state, so it cannot accidentally
reuse an old completion range. Clipboard failure is a DOM-shell fallback, not a
model error.

## Trace 4 — slash command acceptance

1. CodeMirror's rich completion override identifies `/h2` in visible text and
   invokes its apply callback with visible `from/to`.
2. `applyRichSlash(view, from, to, "/h2")` validates that the current visible
   slice is exactly `/h2`, derives the post-token rich block operation, and
   dispatches once.
3. The model result is projected immediately; the completion popup is closed by
   CodeMirror after the callback returns.

The exact token validation gives the adapter ownership of stale completion
ranges. No source/visible conversion is hidden in the completion callback.

## Trace 5 — reverse extension selection

1. The public source bridge calls `richEditorSelectionToSource(document,
   {anchor: editorAnchor, head: editorHead})` and returns serialized source
   UTF-16 offsets in the same direction.
2. `setEditorSelection` receives source `anchor/head`, calls
   `richSourceSelectionToEditor`, and dispatches only a visible selection.
3. A later `replaceSelection` goes through the existing rich transaction filter;
   it never substitutes visible text for the serialized source payload.

This trace intentionally does not route through `RichModelSelectionRange`:
source positions are a public boundary type, and the editor bridge owns their
translation.

## Findings and dispositions

- **F-1 — coordinate ambiguity:** the first signature draft made model and
  CodeMirror ranges structurally interchangeable. Disposition: add explicit
  editor/model range names and conversion signatures; keep source selection
  translation in the existing public bridge.
- **F-2 — stale slash range:** the first draft accepted only numeric token
  endpoints. Disposition: `applyRichSlash` validates the current slice against
  the command before deriving a candidate.
- **F-3 — private dispatcher:** the first draft had no declared one-transaction
  dispatch edge. Disposition: expose `dispatchRichDocumentChange` from the
  existing rich editor state module; adapters do not build model effects.
- **F-4 — clipboard shell omission:** the pure serializer cannot own
  `ClipboardEvent`, default prevention, or cut deletion. Disposition: keep the
  event shell in `copy-markdown.ts`, use the pure model-coordinate serializer,
  and reuse the dispatcher for rich cut/paste.
- **F-5 — stub behavior:** runtime stubs intentionally throw until Phase 5;
  they are not wired into the primary editor during the signature phase. The
  body phase must replace every stub before rich mode imports it.

## Self-Review

The traces show no adjacent pass-through layer: the action and paste adapters
own candidate derivation, while the dispatcher owns the CodeMirror transaction.
The clipboard shell owns DOM fallback, while the pure serializer owns only
Markdown boundary synthesis. The public source bridge remains separate because
its source/visible direction is part of M46's API contract, not a rich UI action.

The only repeated data conversion is the deliberate CRLF conversion at the
CodeMirror/model edge. No trace performs filesystem I/O, source reparsing, or
note-path lookup more than once for the described action.
