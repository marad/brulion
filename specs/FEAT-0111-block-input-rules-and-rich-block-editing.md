---
id: FEAT-0111
title: "Block input rules and rich block editing"
status: draft
depends_on:
  - FEAT-0107
  - FEAT-0109
  - FEAT-0110
---

## Intent

Add loss-aware block input rules and editing operations to the CodeMirror rich
Markdown model. Completed heading, quote, and unordered-list prefixes become
rich block metadata at their documented boundary without making hidden source
prefixes visible or rewriting unrelated Markdown. Enter, Backspace,
continuation, exit, and indentation operate on visible block content while
preserving the Markdown source mapping and ordinary-file fidelity. Ordered-list
syntax follows the P0 matrix: it remains recognized and source-preserving, but
is not normalized or auto-renumbered by this phase.

## Behavior

A completed line prefix is committed only at its boundary: `# ` through `###### `
creates a heading, `> ` creates a quote, and `* ` / `- ` creates an unordered
list item. Incomplete prefixes remain literal. Enter on a non-empty quote or
list item creates the same block prefix on the new line; Enter on an empty item
exits to a plain paragraph. Backspace at an empty block boundary removes the
block prefix or exits the block without exposing hidden source delimiters.
Indentation changes only the selected block's explicit prefix and never
reformats unrelated lines. Ordered-list prefixes are mapped as imported source
and remain untouched unless the user explicitly edits that source. The model
exposes mapping-safe block operations, while existing CodeMirror shortcut and
slash-command adapters that still consume raw EditorState remain a P6
integration concern. Every operation returns visible caret/source mappings and
serializes untouched source bytes exactly.

## Acceptance criteria

- AC-1: Given a visible line ending in a completed `# ` through `###### ` prefix,
  when the heading boundary is applied, then the prefix becomes heading block
  metadata, the visible content starts after the hidden prefix, the caret maps
  to the visible content start, and serialization retains the original prefix
  bytes until that block is edited.
- AC-2: Given a visible line ending in `> `, `* `, or `- `,
  when the block boundary is applied, then it becomes the corresponding quote or
  unordered-list block, incomplete or prefix-like text without boundary
  whitespace remains literal, and UTF-16 source/visible mappings remain
  deterministic.
- AC-3: Given a non-empty quote or unordered-list item,
  when Enter is applied, then a new line continues the same block with the
  canonical continuation prefix and the caret lands at its visible content
  start; given an empty item, when Enter is applied, then the new line exits to
  a plain paragraph without leaving a hidden prefix caret stop.
- AC-4: Given an empty heading, quote, or list block at its visible content
  start, when Backspace is applied, then the block prefix is removed or the
  block exits according to its construct rule, the visible text and caret remain
  valid, and unrelated source spans are unchanged.
- AC-5: Given one or more selected blocks, when indentation or outdentation is
  applied, then only those blocks' prefixes change, nested quote/list structure
  remains representable, and serialization preserves all untouched bytes,
  including line endings and unrelated marker spelling.
- AC-6: Given an imported ordered-list line or unknown block-like syntax,
  when block input/edit operations are applied elsewhere, then it remains an
  opaque/source-preserving region and is not silently renumbered, normalized,
  or converted into another block type.
- AC-7: Given any block operation on Unicode content, CRLF input, nested inline
  marks, or an opaque neighboring line, when it is serialized and mapped, then
  UTF-16 positions, inline rich marks, opaque bytes, and visible caret
  placement remain correct; no operation inserts raw Markdown delimiters into
  the visible projection.
- AC-8: Given the existing raw CodeMirror heading shortcut/slash adapters, when
  this phase is sealed, then they remain explicitly deferred to P6 and no P3
  claim or implementation silently routes them through visible raw-marker
  editing; the rich model's heading metadata and mapping contracts remain the
  only P3 requirement.

## Out of scope

- links, fences, tables, frontmatter, Mermaid, clipboard, Vim, persistence
  wiring, and browser migration; those belong to later M47 phases;
- automatic ordered-list renumbering or Markdown-wide formatting;
- integrating the existing raw CodeMirror heading shortcut/slash adapters (P6);
- replacing CodeMirror or introducing Tiptap/ProseMirror.
