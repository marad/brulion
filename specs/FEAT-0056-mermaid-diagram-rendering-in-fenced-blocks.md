---
id: FEAT-0056
title: mermaid diagram rendering in fenced blocks
status: draft
depends_on: [FEAT-0016]
---

## Intent

A fenced code block tagged `mermaid` holds a diagram description (a flowchart,
sequence diagram, etc.). Today Brulion renders it like any other fenced code block —
the raw Mermaid source in a monospace box — so the diagram never actually appears.
This phase renders that block as the diagram it describes, in place in the editor.

It belongs to the same family as M5 (rendering gaps), M15 (code highlighting), and
M26 (tables): **visual only**. The Mermaid source stays a plain fenced code block in
the file — we decorate how it paints, never rewriting the bytes. That keeps the
file-fidelity moat intact: another tool (or Brulion with this feature absent) still
sees ordinary ```` ```mermaid ```` markdown.

Mermaid is a large library, so it is **loaded lazily** — only when a note actually
contains a Mermaid block — to keep the main bundle small and the editor instant for
the common case. Because Brulion is an offline-capable PWA, the lazily-loaded chunk
is cached by the existing service worker so diagrams keep rendering offline once
seen.

## Behavior

**Rendering.** A *closed* fenced code block whose info string is `mermaid` is
replaced, as a block, by its rendered diagram (an SVG). The block's source text is
unchanged in the document; only its on-screen rendering is replaced.

**Lazy load.** The Mermaid engine is imported on demand the first time a Mermaid
block needs rendering. A note with no Mermaid block never triggers the import.

**Selection reveals the source.** When the selection or cursor is inside a Mermaid
block, the raw fenced source is shown (and is editable) instead of the diagram; when
the selection leaves the block, the diagram is shown again. This mirrors the existing
reveal-on-selection behaviour for other constructs.

**Live update.** Editing the source (which reveals it) and then moving the selection
out re-renders the diagram from the new source. An edit elsewhere in the document
does not re-run Mermaid for an unchanged block.

**Errors.** If Mermaid cannot parse or render the source, the block shows a discreet
error indication in place (with the failure reason) rather than crashing the editor
or showing a broken/empty diagram. Revealing the source (selection) lets the user
fix it.

**Untouched bytes.** Nothing about this feature writes to the file. Rendering,
revealing, erroring, and re-rendering are all display-only.

## Constraints

- **Moat: bytes untouched.** Decorate rendering only; never parse-and-reserialize or
  rewrite the fenced block. *Why:* the file stays portable plain markdown.
- **Lazy, self-hosted, offline-safe.** Mermaid loads via a dynamic import (a separate
  bundle chunk), not eagerly in the main bundle and not from a CDN. The chunk is
  cached by the service worker for offline use. *Why:* lean fast-load + the
  offline-PWA stance.
- **No re-render churn.** An unrelated document edit must not re-run Mermaid for a
  block whose source did not change. *Why:* Mermaid rendering is expensive; the block
  decoration set rebuilds on every doc change.
- **Only closed, `mermaid`-tagged fenced blocks render.** An unterminated fence, or a
  different info string, is left to the normal code-block rendering. *Why:* don't
  render half-typed or non-diagram blocks.
- **Errors never break the editor.** A bad diagram degrades to an in-place error, not
  an exception that disturbs editing or other decorations.

## Out of scope

- **Authoring aids** — a live-preview pane, a Mermaid snippet/template menu, or
  syntax help. This is render-on-display only.
- **Non-fenced or non-`mermaid` diagrams** — only fenced blocks with the `mermaid`
  info string; no other diagram dialects.
- **Exporting/embedding the rendered SVG into the file** — would violate the moat;
  the file keeps the text source only.
- **Theming the diagram to the editor theme** — diagrams use Mermaid's default look
  for now; matching a future light/dark theme (M18) is deferred.

## Acceptance criteria

**AC-1** — A `mermaid` fenced block renders as a diagram.
Given a note containing a closed ```` ```mermaid ```` block with a valid diagram,
When the note is displayed and the selection is outside the block,
Then the block is shown as a rendered diagram (an SVG), not as raw monospace source.

**AC-2** — The source bytes are never modified.
Given a rendered Mermaid block,
When it has been rendered (and re-rendered after edits),
Then the document text of the block is byte-for-byte the original fenced source.

**AC-3** — Selecting inside the block reveals the editable source.
Given a rendered Mermaid block,
When the selection or cursor moves inside the block,
Then the raw fenced source is shown and editable; and when the selection leaves the
block, the diagram is shown again, re-rendered from the current source.

**AC-4** — An unrelated edit does not re-run Mermaid for an unchanged block.
Given a note with a rendered Mermaid block,
When the user edits text elsewhere in the document,
Then the unchanged block's diagram is not re-rendered (its DOM is reused).

**AC-5** — An invalid diagram shows an in-place error, not a crash.
Given a ```` ```mermaid ```` block whose source Mermaid cannot parse,
When the block is displayed with the selection outside it,
Then an in-place error indication (with the reason) is shown and the editor keeps
working.

**AC-6** — The Mermaid engine is loaded lazily.
Given the application bundle,
When a note with no Mermaid block is open,
Then the Mermaid engine is not loaded; it is fetched only when a Mermaid block first
needs rendering, as a separate chunk (not part of the main bundle).
