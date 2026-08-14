# M47 P6 excavation — decisions

## Scope

P6 adapts the existing user-facing editor surfaces to the P5 rich CodeMirror
boundary. It does not replace CodeMirror, introduce a second document model, or
change storage/extension payloads.

## Load-bearing decisions

- **Visible positions are the internal command coordinate system.** Formatting,
  completion, clipboard, paste, and Vim operate on CodeMirror's visible LF
  document. Only the public extension/storage facade translates to serialized
  Markdown UTF-16 offsets.
- **The `RichDocument` state field remains the sole model owner.** Adapters may
  derive a candidate immutable document, but they never cache a second model or
  serialize the visible CodeMirror text directly.
- **Rich actions dispatch one model/visible transaction.** A toolbar button,
  keyboard command, slash acceptance, paste, or cut is one history unit. The
  adapter builds the final `RichDocument` first and rejects the whole action if
  the model cannot represent it safely.
- **Plain-text Markdown is the clipboard contract.** Browser copy/cut and Vim
  yank share one source-map serializer. Paste consumes only `text/plain`; HTML
  clipboard data is deliberately not interpreted in this phase.
- **The existing raw integrations remain raw.** Workbench, script, conflict,
  and other secondary editors keep their current parser/decorations and
  `EditorState` transforms. The rich path is selected only by `opts.rich`.
- **Vim is visible-projection-only in rich mode.** The old hidden-span caret guard
  is retained for raw editors but is not installed for rich editors. The rich
  source-edit functions remain the explicit route for opaque blocks and hidden
  link targets; normal Vim motions never pretend those are visible characters.
- **Rich rendering is decoration-only.** It paints marks, block classes, and link
  attributes from the immutable model. It emits no replace/hide/atomic
  decoration, so it cannot create hidden caret stops or alter serialized bytes.

## Deferred / out of scope

- HTML clipboard interoperability and an HTML-to-Markdown importer;
- a universal raw-source mode UI for every opaque construct;
- reformatting, frontmatter interpretation, or any new metadata sidecar;
- removal of the old raw renderer (P7).

## Error model

Synchronous pure model operations return `null` for an unsupported or stale
operation and throw `RangeError` only for invalid coordinate contracts. DOM
handlers return `false` when they cannot safely handle an event so CodeMirror or
the browser can retain its existing behavior. No adapter catches a failed
candidate and dispatches a partial visible edit.

## Self-review

The first draft considered keeping separate command, clipboard, and paste
models. Re-reading P5's ownership rule rejects that: they would duplicate rich
state and create source/model drift. The final split is by boundary responsibility
(renderer, model action, clipboard, completion, Vim), while every mutation routes
through one rich-editor dispatch helper.

A source-coordinate command API was also considered and rejected for normal
editing: it would make visible selections cross hidden delimiters again. Source
coordinates remain only at the extension/storage boundary and in explicit P4
source-edit operations.

The smallest viable implementation keeps raw-format action functions intact and
adds rich dispatch branches rather than rewriting all raw secondary editors.
