---
id: FEAT-0042
title: Frontmatter visual rendering
status: draft
depends_on: [FEAT-0006, FEAT-0016]
---

## Intent

A note that begins with a YAML frontmatter block — a `---` line, some metadata
lines, a closing `---` (or `...`) line — renders that block as raw fenced text at
the very top of the editor. It is ugly, it pushes the actual note down, and it is
the one common construct that still leaks raw markup, breaking the M2 promise.

This phase renders a leading frontmatter block as a **discreet, collapsed
"metadata" region** that the user can expand to view and edit the raw text. It is
**visual only**: like FEAT-0006/FEAT-0016, the on-disk bytes are never modified.
The region is treated as **opaque** — no field (`title`/`tags`/`aliases`) is
interpreted and the text is never parsed-and-reserialised — so other tools see
the exact bytes the user wrote (the file-fidelity moat).

## Behavior

**Detection (pure).** A frontmatter block is recognised structurally, not via the
markdown parser (Lezer ships no frontmatter node, and a bare leading `---` is
otherwise ambiguous with a thematic break / setext underline). The rule, matching
the Obsidian/Jekyll/pandoc convention:

- The very first line of the document is exactly `---` (only that, ignoring a
  trailing carriage return / spaces).
- A later line is exactly `---` or `...` — the closing delimiter.
- The block is the byte range from the document start through the end of that
  closing delimiter line.

A pure function over the editor state returns this range, or nothing when there
is no leading `---` or no closing delimiter yet. **Only a closed block renders** —
a leading `---` still being typed, with no closing delimiter, stays raw (the same
rule as an unclosed fenced code block and a bare `#` heading).

**Rendering (a state field).** Block-level decorations change layout, so the
frontmatter renderer is a CodeMirror state field (like the FEAT-0016 block field),
not the viewport plugin. It has two states, with **collapsed as the default**:

- **Collapsed** — the whole block is replaced by a single discreet, clickable
  chip reading `metadata` (with a collapsed indicator, e.g. `▸`). The raw lines
  are not shown, but the bytes remain in the document. The chip is atomic, so the
  caret steps over it.
- **Expanded** — clicking the chip reveals the raw frontmatter text, set off in a
  subtle box, with a clickable header (e.g. `▾ metadata`) that collapses it again.
  No `---` is hidden; the user edits the raw text directly.

**Opaqueness.** No field is interpreted; the text between the delimiters is never
parsed or rewritten. The decorations change only the display.

**Collapse state resets on note load.** Because loading a note replaces the
document within the same editor state, the collapsed/expanded flag would otherwise
persist across note switches. On a programmatic (non-user) document load the
field resets to collapsed, so every note opens with its frontmatter discreet.

## Constraints

- **No document mutation.** Decorations only hide/style; saving a note with
  frontmatter round-trips the exact original bytes (delimiters, quoting, order,
  indentation, blank lines — all verbatim).
- **Opaque.** No `title`/`tags`/`aliases` (or any field) interpretation, and no
  parse-and-reserialise of the block.
- Only a **closed** block (leading `---` plus a later `---`/`...`) renders; an
  unclosed one stays raw.
- Only a block at the **document start** is frontmatter; a `---` further down is
  left to the normal markdown rendering.
- The collapsed chip is **atomic** so the caret cannot land inside the hidden
  block.
- The detector is **pure** (depends only on the parsed/​text state, mutates
  nothing), matching the FEAT-0006/FEAT-0016 contract.

## Out of scope

- **Field interpretation** — surfacing `title`/`tags`/`aliases` as anything other
  than raw text (`title` especially collides with the filename-as-identity model
  and M14); deferred.
- **Creating / editing frontmatter through a form** — the user edits the raw text;
  no structured editor.
- **Non-leading `---…---` blocks**, and frontmatter using fences other than `---`
  open with `---`/`...` close (e.g. TOML `+++`) — not the reported pain.
- **Persisting the expand/collapse choice** across reloads or per note — it is
  ephemeral UI state that resets to collapsed.

## Acceptance criteria

**AC-1** — A leading, closed frontmatter block is detected with its byte range.
Given a document whose first line is exactly `---` and that has a later line equal
to `---` or `...`,
When the frontmatter detector runs over the state,
Then it returns the range from the document start through the end of the closing
delimiter line.

**AC-2** — A leading `---` with no closing delimiter is not frontmatter.
Given a document that starts with `---` but has no later `---`/`...` line,
When the detector runs,
Then it returns no frontmatter range (the block stays raw, like an unclosed
fence).

**AC-3** — A `---` that is not the first line is not frontmatter.
Given a document whose first line is not `---` (e.g. body text, then a `---` line
further down),
When the detector runs,
Then it returns no frontmatter range.

**AC-4** — A frontmatter block renders collapsed by default.
Given a note that opens with a leading, closed frontmatter block,
When the editor renders it,
Then the raw frontmatter lines are not shown; in their place is a single discreet
`metadata` chip, and the rest of the note follows immediately after it.

**AC-5** — Clicking the collapsed chip expands the region.
Given the collapsed `metadata` chip,
When the user clicks it,
Then the raw frontmatter text (including the `---` delimiters) becomes visible,
set off as a region, with a header control to collapse it again.

**AC-6** — Clicking the expanded header collapses the region.
Given the frontmatter region expanded,
When the user clicks its collapse header,
Then it returns to the single collapsed `metadata` chip.

**AC-7** — Rendering never changes the saved bytes.
Given a note whose content begins with a frontmatter block,
When the note is saved to disk (whether the region was collapsed or expanded),
Then the file contains exactly the original bytes — the frontmatter delimiters and
every metadata line verbatim, with no reordering, requoting, or reindenting.

**AC-8** — The collapsed chip is atomic to the caret.
Given a note with a collapsed frontmatter chip followed by body text,
When the caret moves across the chip,
Then it lands on the body side of the chip, never inside the hidden block.

**AC-9** — Switching notes reopens frontmatter collapsed.
Given a note whose frontmatter region the user expanded,
When a different note is loaded into the editor and it too has frontmatter,
Then that note's frontmatter renders collapsed (the expanded state does not carry
over).
