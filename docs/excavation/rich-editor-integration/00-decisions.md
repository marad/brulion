# M47 P5 rich editor integration decisions

## Scope

P5 connects the loss-aware `RichDocument` to the primary CodeMirror note editor
and existing note-controller save/refresh/conflict paths. P6 remains responsible
for the user-facing selection/clipboard/command/Vim adapters; P7 removes obsolete
rendering paths and validates the complete browser migration.

## Load-bearing decisions

- **Primary editor mode is opt-in.** `mountEditor` keeps a raw default for the
  workbench, conflict diff, script editor, and existing raw EditorState seams.
  The main note editor explicitly enables the rich boundary, so secondary
  CodeMirror surfaces cannot accidentally inherit source-map state.
- **The rich model is a CodeMirror state field plus transaction filter.** The
  state field owns the current `RichDocument`; the filter applies visible user
  changes to that model before the transaction is committed and projects the
  resulting visible text in the same history transaction. This avoids a raw
  marker transaction followed by a second cleanup transaction.
- **Serialized Markdown is the storage boundary.** `readMarkdown()` returns the
  model's loss-aware serialization (raw `view.state.doc` only for raw editors).
  The note controller tracks a saved serialized snapshot and recomputes dirty
  from serialized source, not from visible text length or equality.
- **External refresh reparses source and maps through source.** The old visible
  caret/viewport anchor first maps to the old source, then through the minimal
  old-source/new-source change, and finally into the new visible projection.
  If the source position was replaced, the mapped position clamps to the new
  replacement boundary; no stale model is retained.
- **Raw source APIs translate at the boundary.** Extension-facing text and
  selection coordinates are serialized source/UTF-16 coordinates. The primary
  editor converts source positions to visible positions only while dispatching
  into CodeMirror; raw editor mounts remain direct.
- **Opaque special blocks remain direct source islands.** P4's pure model still
  rejects ordinary `replaceVisible` edits inside a special node. The primary
  editor boundary treats a raw special island as explicit source editing, using
  direct source coordinates and reimporting it; no rendered widget output is
  ever serialized.
- **Failure is atomic.** A failed projection/load/reparse leaves the prior rich
  model, visible document, serialized snapshot, and controller dirty/conflict
  state intact. Disk writes still use the existing mtime guard as the final
  authority.

## Deferred

- Selection-aware Markdown copy/cut and formatting commands over rich visible
  ranges (P6).
- Full Vim behavior over the visible projection and source-edit affordances for
  special blocks (P6/P7).
- Removal of legacy renderer extensions and real Chromium/OPFS migration tests
  (P7).
