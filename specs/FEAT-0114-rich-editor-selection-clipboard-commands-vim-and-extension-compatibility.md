---
id: FEAT-0114
title: "Rich editor selection, clipboard, commands, Vim, and extension compatibility"
status: draft
depends_on:
  - FEAT-0107
  - FEAT-0109
  - FEAT-0110
  - FEAT-0111
  - FEAT-0112
  - FEAT-0113
---

## Intent

Finish the user-facing CodeMirror adapters around the M47 rich Markdown
projection. Formatting, completion, clipboard, navigation, Vim, and extension
selection must operate on visible text internally while Markdown remains the
serialized source at the public/storage boundary. A user must not get a second,
raw-Markdown editing path merely because an existing command or browser event
was written before the rich projection existed.

## Behavior

The primary rich editor decorates its visible projection from the current
`RichDocument`: marks and block kinds remain visual state, links retain their
navigation metadata, and no decoration introduces a hidden source caret stop.
Formatting actions use visible selections and the rich model's loss-aware
operations. A single action, including a slash command or a completed Markdown
input action, is one CodeMirror history unit; raw delimiters are never inserted
into the visible document as a side effect of a command.

Copy and cut serialize the selected visible ranges to `text/plain` Markdown that
preserves the selected formatting and link meaning. Boundary markers are
synthesized only as needed for the selected fragment, using imported delimiter
spelling when it is unambiguous and the model's canonical spelling for new
wrappers. A cut deletes exactly the visible selection and leaves valid source;
empty formatting wrappers created by deleting their complete content are removed.
Paste consumes `text/plain` through the rich visible-edit boundary and flushes
complete pasted Markdown at the paste boundary. External HTML clipboard data is
not interpreted.

The slash menu and wikilink autocomplete are available in the rich editor and
replace visible ranges through rich transactions. Heading commands, clear
formatting, and wikilink acceptance therefore preserve the source map and
re-render the visible projection immediately. Heading-anchor navigation finds
the first matching heading in serialized Markdown and maps its source position
to the visible heading content, including Unicode and CRLF documents.

Opt-in Vim motions and edits operate over the visible projection. The legacy
hidden-Markdown caret guard is not installed for a rich view; Vim yank uses the
same rich selection serializer as browser copy, and Vim paste remains a visible
rich edit. Vim and the normal editor never expose hidden Markdown delimiters as
ordinary motion targets. The explicit raw-source model operations remain the
only route for editing opaque/special source islands or link targets.

The extension API remains source-compatible: editor text and selection offsets
are serialized Markdown/UTF-16 source offsets, including `anchor`/`head`
direction. Setting a source selection maps it to visible positions, and replacing
that selection goes back through the rich boundary without writing the visible
projection as Markdown. Raw workbench, script, and conflict-diff editors remain
ordinary CodeMirror documents.

## Acceptance criteria

- AC-1: Given a loaded rich document containing headings, nested inline marks,
  quotes, lists, links, and Unicode, when it is displayed, then the CodeMirror
  projection styles the corresponding visible spans and block lines, link spans
  expose the existing navigation metadata, and no Markdown delimiter/prefix is
  present as a visible or atomic caret range.
- AC-2: Given a non-empty visible selection, when Bold, Italic, Code, Heading,
  or Clear formatting is invoked from the selection toolbar, keyboard command,
  or slash command, then the rich model performs the operation at visible
  positions, the resulting serialized Markdown retains unrelated source bytes,
  and the complete action is one undo/history unit. Invalid, cross-opaque, or
  unsupported selections are rejected without a partial write.
- AC-3: Given a visible selection that starts or ends inside a formatted span,
  block prefix, or link label, when the user copies it, then the clipboard's
  `text/plain` value is valid Markdown containing only the selected content plus
  the minimum boundary syntax needed to preserve the formatting/link meaning.
  Imported delimiters and source line endings are retained when determinable;
  empty selections produce no custom clipboard payload.
- AC-4: Given a non-empty visible selection, when the user cuts it, then exactly
  the selected visible content is removed, the rich projection and serialized
  source remain synchronized, complete empty formatting wrappers are removed,
  and undo restores both the visible selection content and its original source
  spelling. A raw/opaque special block is never rewritten by ordinary cut.
- AC-5: Given plain-text Markdown or text copied from the rich editor on the
  clipboard, when it is pasted into a rich selection, then the text enters via
  the visible rich-edit boundary, complete markers are flushed at the paste
  boundary, one paste is one undo unit, and HTML clipboard data is ignored.
  Existing rich marks and opaque/special source outside the pasted range remain
  unchanged.
- AC-6: Given a rich editor with a visible line, when the user opens the slash
  menu or types `[[` and accepts a heading/clear command or an existing-note
  wikilink, then the command replaces only its visible token/range, closes the
  completion, and the resulting rich/source projection is immediately usable
  without raw Markdown offsets or duplicate `]]` delimiters.
- AC-7: Given serialized Markdown with duplicate, Unicode, or CRLF headings,
  when a local link/extension requests a heading anchor, then the first matching
  heading is selected and scrolled using visible positions, the caret lands on
  visible heading content rather than a hidden prefix, and a missing anchor is a
  no-op.
- AC-8: Given Vim mode enabled on the primary rich editor, when the user moves,
  selects, yanks, deletes, or pastes, then motions and selections use visible
  projection offsets, yank uses the same boundary-fidelity Markdown as browser
  copy, and hidden delimiters are never normal motion targets. The legacy hidden
  syntax guard is absent from rich mode; explicit opaque/source edits remain
  outside normal Vim motions and are covered as a documented limitation.
- AC-9: Given an extension reading or setting the primary editor selection, when
  the rich document contains hidden Markdown syntax, reverse selections, Unicode,
  or CRLF, then `getText` and selection `anchor`/`head`/`text` remain serialized
  Markdown and UTF-16 source-compatible, `setSelection` maps through the source
  map, and `replaceSelection` mutates only the intended rich/source span. Raw
  secondary editors retain their existing direct CodeMirror behavior.
- AC-10: Given an invalid/stale rich selection, unavailable clipboard, malformed
  completion token, or unsupported opaque edit, when the adapter handles the
  request, then it returns/falls through without throwing an unhandled DOM error,
  does not partially dispatch, and leaves the prior model, serialized source,
  dirty state, and conflict state intact.

## Out of scope

- External `text/html` clipboard interoperability or HTML-to-Markdown paste;
- a general Markdown reformatter, metadata sidecar, or hidden source document;
- automatic interpretation/editing of frontmatter, Mermaid, tables, or unknown
  syntax through ordinary visible commands;
- a new raw-source UI for every opaque construct; existing explicit model source
  edit operations remain the source-editing boundary;
- changes to FSA, note ownership, workspace identity, extension capabilities,
  or the serialized extension API shape;
- removal of the legacy renderer implementation and full Chromium/OPFS migration;
  those are FEAT-0115/P7.
