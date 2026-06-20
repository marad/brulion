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

When the user types `/` at the start of a line **or right after a space**, a
completion menu opens listing the slash commands. (The whitespace/line-start
boundary is what scopes it — a `/` in the middle of a word or inside a URL like
`http://` does **not** open the menu, so ordinary text with slashes is
unaffected.) As the user types more (`/h`, `/h1`), the list filters to matching
commands. The menu is keyboard-navigable: ↑/↓ move the highlight, Enter accepts
the highlighted command, Esc dismisses it.

The commands are:

- **`/h1`, `/h2`, `/h3`** — turn the current line into a heading of that level.
- **`/clear`** — turn the current line back into a plain paragraph (strip any
  heading prefix).

Accepting a command removes **only** the typed `/command` token from the line —
any other text on the line is preserved (the row is never wiped) — and applies
the transform to what remains, leaving the caret ready to keep typing. Dismissing
the menu (Esc) leaves the typed text in place as ordinary characters.

Only clean markdown is written — the actions add/remove `#` prefixes exactly like
the heading shortcuts; the `/command` token never persists in the saved file once
a command is accepted.

## Constraints

- Reuse the FEAT-0007 heading transforms for the actions; do not re-derive how to
  build a heading.
- The trigger is `/` at a line-start or post-whitespace boundary — a slash inside
  a word or URL must not open the menu.
- Accepting a command must remove only the `/command` token (never written to
  disk) and preserve any other text on the line.
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

**AC-6** — A slash after a space opens the menu mid-line; a slash inside a word
or URL does not.
Given a line already containing text,
When the user types `/` right after a space (e.g. `note /h`),
Then the slash menu appears; but when a `/` is typed inside a word or URL (e.g.
`and/or`, `http://`), no menu appears and the `/` is an ordinary character.

**AC-7** — Accepting a command preserves the rest of the line.
Given a line `note /h2` with the menu open,
When the user accepts `/h2`,
Then only the `/h2` token is removed and the remaining text is reshaped — the
on-disk line is `## note ` (the word `note` is not wiped).
