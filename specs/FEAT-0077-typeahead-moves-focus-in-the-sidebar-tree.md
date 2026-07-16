---
id: FEAT-0077
title: Typeahead moves focus in the sidebar tree
status: draft
depends_on: [FEAT-0075]
---

## Intent

Keyboard navigation of the sidebar tree (FEAT-0075) moves one row at a time with
the arrow keys. In a real vault that is slow: reaching a note ten rows down means
ten Down presses, and there is no way to jump straight to "the note that starts
with p". Every file explorer, list box, and IDE tree answers this with
typeahead — start typing a name and focus jumps to the matching row. This adds
that: with focus in the tree, typing a printable character moves focus to the
next visible row whose name starts with what was typed, so a large vault is
navigable by name, not just by counting rows. It is movement only — it opens
nothing and writes nothing, consistent with FEAT-0075's "movement only" stance.

## Behavior

While focus is on a tree row, typing a **printable character** (a single
character with no Ctrl/Cmd/Alt modifier) starts or extends a short typeahead
search and moves focus to the matching row:

- The search buffer accumulates the characters typed in quick succession.
  Characters typed within a short window (the coalescing timeout) **extend** the
  buffer; after the window lapses with no keystroke, the buffer **resets**, so
  the next character starts a fresh single-character search.
- The match is the next **visible** row (FEAT-0075's visible-row set — a
  collapsed folder's children are skipped) whose display label
  **starts with** the buffer, compared **case-insensitively**. The search begins
  at the row *after* the focused one and **wraps around**, so it can land on any
  visible row including, if nothing else matches, the focused row itself.
- On a match, focus moves to that row and the roving tab stop moves with it
  (exactly as arrow-key movement does). On no match, focus stays where it is.
- Because a single repeated character (after each reset) searches from the row
  after the current one and wraps, pressing the same letter repeatedly **cycles**
  through all visible rows whose label starts with that letter.

Typeahead never opens a note, toggles a folder, or writes a file — it only moves
focus. It composes with, and does not disturb, the existing tree keys: the
FEAT-0075 navigation keys (Up/Down/Left/Right/Home/End/Enter/Space) and F2
(FEAT-0076) keep their behavior; typeahead only handles printable keys those do
not already claim (Space stays "activate", never a typeahead character). The keys
are handled only while focus is on a tree row, so typing never triggers typeahead
from the editor or any overlay.

## Constraints

- Only printable single characters with no Ctrl/Cmd/Alt modifier drive typeahead;
  every navigation/activation/rename key keeps its existing meaning.
- Matching is over the *visible* rows only and by the row's displayed label
  (the note/folder name as shown, not its full path), case-insensitively, by
  prefix.
- The buffer coalesces successive keystrokes within a fixed short timeout and
  resets after it; the timeout is an internal constant, not user-configurable.
- Movement only: no note is opened, no folder toggled, no file written by
  typeahead.
- Handled only when focus is within the tree on a row (same scoping as
  FEAT-0075).

## Out of scope

- Fuzzy or substring matching (the Ctrl+K quick switcher, FEAT-0033, already
  offers fuzzy search across the whole vault) — this is strict prefix on the
  visible rows.
- Matching against the full path or any hidden (collapsed) rows.
- Expanding a collapsed folder to reach a match inside it — typeahead only lands
  on already-visible rows.
- A visible "search string" indicator or any persistent UI.

## Acceptance criteria

**AC-1** — A printable key moves focus to the next matching visible row.
Given focus is on a tree row and one or more later visible rows have display
labels starting with the letter `p` (case-insensitively),
When the user presses `p`,
Then focus moves to the next such visible row (searching after the focused row
and wrapping), and it becomes the sole Tab-focusable row.

**AC-2** — Successive characters within the timeout extend the search.
Given the user has just pressed `r` (matching some row) and presses `e` within
the coalescing timeout,
When the second key is handled,
Then focus moves to the next visible row whose label starts with `re`, not merely
`e` — the buffer accumulated `re`.

**AC-3** — The buffer resets after the timeout lapses.
Given the user pressed some characters and then paused longer than the coalescing
timeout,
When the user next presses a single character `c`,
Then the search matches labels starting with just `c` — the previous buffer was
discarded.

**AC-4** — Repeating a letter cycles through the rows starting with it.
Given several visible rows have labels starting with `a`, and the buffer has
reset between presses,
When the user presses `a` repeatedly,
Then focus advances to the next `a`-row on each press and wraps back to the first
after the last — it does not stay on one row.

**AC-5** — No match leaves focus unchanged.
Given no visible row's label starts with the typed buffer,
When the user types it,
Then focus does not move and no row is opened or toggled.

**AC-6** — Typeahead opens nothing and writes nothing.
Given any sequence of printable characters typed with focus in the tree,
When the sequence has run,
Then no note has been opened, no folder toggled, and no file created, modified,
or deleted — only focus moved.

**AC-7** — Typeahead does not disturb the navigation, activation, or rename keys.
Given focus is on a tree row,
When the user presses a FEAT-0075 navigation key, Enter/Space, or F2
(FEAT-0076),
Then that key behaves exactly as its own spec defines — typeahead handles only
printable keys those keys do not already claim.
