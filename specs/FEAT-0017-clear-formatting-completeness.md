---
id: FEAT-0017
title: Clear Formatting completeness
status: draft
depends_on: [FEAT-0008, FEAT-0009, FEAT-0016]
---

## Intent

M2's promise is that the user never has to touch raw markdown markup. "Clear
formatting" (the right-click menu, FEAT-0009) and `/clear` (the slash command,
FEAT-0008) are the escape hatch — the one action that should return any styled
text to a plain paragraph. Today they only reset the heading level: bold,
italic, and inline code survive, and (now that FEAT-0016 renders them)
blockquotes and bullet lists do too. So a user who wants to strip formatting is
left with markup the UI claims it would clear, and no way to remove it without
editing raw characters — exactly the thing the product promises to spare them.

This phase makes Clear Formatting live up to its name: across the lines the
action touches, it removes **all** the markup the editor renders — inline
(bold/italic/inline code) and block (heading, blockquote, unordered list) —
leaving plain paragraph text. The folder still holds plain markdown the user owns
(the moat): clearing writes only the unwrapped text, removing marker characters,
never inventing new ones.

## Behavior

A single transform underlies both entry points (the one-definition rule from
FEAT-0007/8/9), so "Clear formatting" and `/clear` strip exactly the same things:

- **Inline marks** — `**bold**`/`__bold__`, `*italic*`/`_italic_`, and
  `` `inline code` `` are unwrapped to their inner text. Unwrapping is driven by
  the parsed markdown structure (the marker nodes the grammar identifies), never
  a raw character scan, so a `*` inside `**` is handled correctly and nested
  marks (`**_x_**`) fully unwrap.
- **Block prefixes** — a leading heading `#`…`######`, a blockquote `>`, and an
  unordered-list `*`/`-` marker (each with the single space that follows it, when
  present) are removed from every line the action covers.
- **Scope** — "Clear formatting" clears every line the selection touches (a caret
  with no selection clears its own line); `/clear` clears the line the command
  was typed on and also removes the `/clear` token itself.
- A line (or selection) with nothing to strip produces **no change** — the
  transform returns nothing so the undo history isn't polluted with an empty edit
  (the same `null`-on-no-op contract as the other transforms).

Deliberately left in place (documented, not silent): **ordered-list numbers**
(`1.`) and **fenced-code fences** (```` ``` ````). Ordered lists aren't part of
the FEAT-0016 rendered set this phase mirrors, and stripping a fenced block's
fences would reflow multi-line code into prose — a destructive structural change,
not a formatting reset. Both are out of scope here.

## Constraints

- **One transform, two callers.** The menu item and the slash command both route
  through the same pure transform; neither re-derives how to strip markup.
- **Parse-driven, not regex.** Inline unwrapping uses the markdown syntax tree, to
  avoid the `*`-inside-`**` ambiguity a character scan hits.
- **File fidelity.** Only marker characters are removed; the remaining text is the
  user's own, written back verbatim. No new markup is introduced.
- **No-op is null.** When nothing would change, issue no transaction.

## Out of scope

- Ordered-list numbers and fenced-code fences (see Behavior — left in place).
- A "clear inline only" vs "clear block only" distinction — Clear Formatting is
  one all-or-nothing action.
- Tables, images, links — not part of the rendered set; links are M8.

## Acceptance criteria

**AC-1** — Clear Formatting unwraps inline marks to plain text.
Given a selection covering `a **bold** and *italic* and ` `` `code` ``,
When Clear Formatting runs,
Then the line becomes `a bold and italic and code` with no `*`, `_`, or `` ` ``
markers remaining.

**AC-2** — Clear Formatting strips a heading prefix.
Given the caret is on a line `## Title`,
When Clear Formatting runs,
Then the line becomes `Title` (the `## ` prefix is gone).

**AC-3** — Clear Formatting strips a blockquote marker.
Given the caret is on a line `> quoted`,
When Clear Formatting runs,
Then the line becomes `quoted` (the `> ` prefix is gone).

**AC-4** — Clear Formatting strips an unordered-list marker.
Given the caret is on a line `* item` (or `- item`),
When Clear Formatting runs,
Then the line becomes `item` (the `* `/`- ` marker is gone).

**AC-5** — Clear Formatting clears every line a multi-line selection touches.
Given a selection spanning `# Heading`, a line with `**bold**`, and `> quote`,
When Clear Formatting runs,
Then all three lines are reduced to their plain text with every marker removed.

**AC-6** — Clear Formatting unwraps nested inline marks completely.
Given a line containing `**_x_**`,
When Clear Formatting runs,
Then the line becomes `x` (both the bold and the italic markers are removed).

**AC-7** — Clearing a line with no formatting is a no-op.
Given the caret is on a plain line `just text`,
When Clear Formatting runs,
Then no change is made (no transaction is dispatched).

**AC-8** — `/clear` strips formatting and removes its own token.
Given a line `## heading with **bold**` and the user types and accepts `/clear`
on that line,
When the command applies,
Then the `/clear` token is removed and the line is reduced to plain text with the
heading prefix and the `**` markers gone.

**AC-9** — Both entry points run the same clearing.
Given any formatted line,
When it is cleared via the right-click "Clear formatting" item and (separately)
via `/clear`,
Then the resulting plain text is identical.

**AC-10** — Ordered-list numbers and fenced-code fences are left intact.
Given a line `1. item` and a fenced code block,
When Clear Formatting runs over them,
Then the `1.` and the ```` ``` ```` fences remain (these are deliberately out of
scope).
