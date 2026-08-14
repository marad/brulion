# M47 P6 — adapter signatures

These signatures distinguish CodeMirror-visible LF coordinates from
`RichDocument.visible` model coordinates. The numeric offsets are intentionally
converted at the rich-editor edge; callers must not pass a CodeMirror offset to
a pure model serializer.

## Coordinate payloads

```ts
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
```

`rich-editor.ts` exposes the existing conversion contract alongside its current
source bridge:

```ts
export function richEditorPositionToModel(document: RichDocument, position: number): number
export function richModelPositionToEditor(document: RichDocument, position: number): number
export function richEditorRangeToModel(
  document: RichDocument,
  range: RichEditorSelectionRange,
): RichModelSelectionRange
export function richModelSelectionToEditor(
  document: RichDocument,
  selection: RichVisibleSelection,
): RichVisibleSelection
export function dispatchRichDocumentChange(
  view: EditorView,
  document: RichDocument,
  selection: RichVisibleSelection,
  userEvent?: string,
): void
```

The existing `RichVisibleSelection` continues to mean model-visible positions
inside pure model APIs; `richModelSelectionToEditor` returns a CodeMirror
selection for dispatch. `richEditorSelectionToSource` and
`richSourceSelectionToEditor` remain the public raw-source bridge.

## Rich action/clipboard adapter

```ts
export type RichFormatAction =
  | "Bold"
  | "Italic"
  | "Code"
  | "Heading 1"
  | "Heading 2"
  | "Heading 3"
  | "Clear formatting"

/** Apply one visible rich formatting action, or return false without dispatch. */
export function applyRichFormat(view: EditorView, action: RichFormatAction): boolean

/** Remove one exact visible slash token and apply its rich command atomically. */
export function applyRichSlash(
  view: EditorView,
  tokenFrom: number,
  tokenTo: number,
  command: "/h1" | "/h2" | "/h3" | "/clear",
): boolean

/** Paste plain text into the current CodeMirror-visible selection. */
export function applyRichPaste(view: EditorView, text: string): boolean

/** Serialize model-visible ranges to an ephemeral Markdown clipboard payload. */
export function serializeRichSelection(
  document: RichDocument,
  ranges: readonly RichModelSelectionRange[],
): string
```

Mutating adapters accept CodeMirror-visible positions, convert once to model
positions, derive a complete next document, and dispatch once. Invalid or
unsupported operations return `false` with no dispatch. The pure serializer is
total for empty/out-of-bounds ranges (they contribute no text) and never mutates
source.

## Rich rendering

```ts
/** Decoration-only renderer for a primary rich view. */
export function richRendering(): Extension
```

The extension reads the current `RichDocument` and `linkContext`; it emits only
mark/line decorations and fixed `data-href`/`data-note`/`data-anchor` values.
It emits no replace, hide, or atomic decorations.

## Completion adapter additions

```ts
/** Direct completion sources usable without a Markdown language parser. */
export function slashSource(context: CompletionContext): CompletionResult | null
export function wikilinkSource(context: CompletionContext): CompletionResult | null
```

Raw mounts keep the existing `markdownLanguage.data` registrations. Rich mounts
pass these sources to CodeMirror's `autocompletion` override. Completion apply
callbacks receive CodeMirror-visible `from/to` and dispatch visible changes, so
the rich transaction boundary—not a source-coordinate callback—owns the edit.
Slash apply validates that the current visible slice is still the requested
command token before dispatching.

## Error contract

- `RangeError` remains the existing error for direct invalid source/selection
  bridge calls. Rich DOM/action adapters catch bounded model range failures and
  return `false` before dispatch.
- A rejected rich action, stale slash token, missing clipboard payload, or
  unsupported opaque selection leaves the entire prior view state unchanged.
- `richRendering()` is synchronous and stateless; malformed ranges are skipped
  rather than written back or thrown through a browser event.

## Signature-fit review and dispositions

A cold read found four composition problems. First, the initial serializer
signature accepted structurally identical numeric ranges from either coordinate
space; the contract now names separate editor/model range types and requires an
explicit conversion helper. Second, the initial slash signature could apply a
stale numeric range; the adapter now validates the current token text against its
command. Third, the initial signature list omitted the clipboard event boundary;
DOM copy/cut remains owned by `copy-markdown.ts`, whose rich branch now calls the
pure serializer and dispatch helper, while the signature document explicitly
makes the pure serializer model-coordinate-only. Fourth, the model dispatcher
was private; `dispatchRichDocumentChange` is now the one declared mutation edge.

Vim yank and completion do not need new source-coordinate APIs: yank calls the
shared copy entry point, and completion callbacks dispatch CodeMirror-visible
changes that the transaction filter converts. This avoids a pass-through
“rich completion service” that would duplicate CodeMirror's completion lifecycle.

The return contract is deliberately boolean for mutating DOM adapters: callers
need only know whether the event was consumed, while the unchanged state is the
observable failure guarantee. Pure copy is total and returns text, so unavailable
clipboard is handled by the DOM shell rather than hidden in a serializer result.
