---
id: FEAT-0008
title: Slash commands
status: draft
depends_on: [FEAT-0007]
---

## Intent

Keyboard shortcuts (FEAT-0007) are fast once learned, but a quick-capture tool
also needs a discoverable way to reshape a line — you shouldn't have to memorize
chords. This phase adds **slash commands**: type `/` at the start of a line and a
small menu appears (`/h1`, `/h2`, `/h3`, `/clear`); pick one and the line is
reshaped, with the `/command` token removed. It's the Notion-style affordance for
turning a line into a heading or clearing it back to a paragraph.

The menu, its filtering, keyboard navigation, and positioning are provided by
CodeMirror's existing autocomplete machinery (already bundled) rather than a
hand-rolled popup — the lean choice. The command *actions* reuse the same pure
heading transforms as the shortcuts (FEAT-0007), so there is one definition of
"make this line an H2".

## Behavior

When the user types `/` at the very start of a line (the line's text so far is
`/` optionally followed by word characters, and nothing precedes it on the line),
a completion menu opens listing the slash commands. As the user types more (`/h`,
`/h1`), the list filters to matching commands. The menu is keyboard-navigable:
↑/↓ move the highlight, Enter accepts the highlighted command, Esc dismisses it.

The commands are:

- **`/h1`, `/h2`, `/h3`** — turn the current line into a heading of that level.
- **`/clear`** — turn the current line back into a plain paragraph (strip any
  heading prefix).

Accepting a command removes the typed `/command` token from the line and applies
the transform to whatever text remains on the line, leaving the caret ready to
keep typing. The menu does not appear for a `/` that is not at the line start
(e.g. a slash inside a sentence or in a URL), so ordinary text containing slashes
is unaffected. Dismissing the menu (Esc) leaves the typed text in place as
ordinary characters.

Only clean markdown is written — the actions add/remove `#` prefixes exactly like
the heading shortcuts; the `/command` token never persists in the saved file once
a command is accepted.

## Constraints

- Reuse the FEAT-0007 heading transforms for the actions; do not re-derive how to
  build a heading.
- The trigger is `/` at line start only — a slash elsewhere in a line must not
  open the menu.
- Accepting a command must remove the `/command` token (it must never be written
  to disk).
- Use the editor's existing autocomplete facility for the menu UI (no bespoke
  popup, no toolbar).

## Out of scope

- Inline slash commands for bold/italic (those are the Ctrl shortcuts /
  right-click menu).
- Slash commands for lists, links, quotes, etc. — only headings + clear for now.
- Right-click multi-line popup — FEAT-0009.

## Acceptance criteria

**AC-1** — Typing `/` at the start of a line opens the slash menu.
Given the caret is at the start of an empty line,
When the user types `/`,
Then a menu listing the slash commands (`/h1`, `/h2`, `/h3`, `/clear`) appears.

**AC-2** — The menu filters as the user types.
Given the slash menu is open,
When the user types `h`,
Then only the heading commands (`/h1`, `/h2`, `/h3`) remain in the menu (`/clear`
is filtered out).

**AC-3** — Accepting `/h2` turns the line into an H2 and drops the token.
Given the line contains `/h2` with the menu open,
When the user accepts the `/h2` command,
Then the `/h2` token is gone and the line is an H2; typing `Title` then yields the
on-disk line `## Title`.

**AC-4** — `/clear` returns the line to a plain paragraph.
Given a line that is a heading (e.g. created via `/h1`),
When the user runs `/clear` on it,
Then the line has no heading prefix on disk (it is a plain paragraph).

**AC-5** — Esc dismisses the menu, leaving typed text as-is.
Given the slash menu is open after typing `/h`,
When the user presses Esc,
Then the menu closes and no reshape happens (the line still reads `/h` as typed,
nothing crashed).

**AC-6** — A slash that is not at the line start does not open the menu.
Given a line already containing text (e.g. `see `),
When the user types `/` after that text,
Then no slash menu appears and the `/` is just an ordinary character.
