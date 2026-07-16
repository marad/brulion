---
id: FEAT-0075
title: Keyboard navigation for the sidebar tree
status: draft
depends_on: [FEAT-0024, FEAT-0043, FEAT-0071]
---

## Intent

The sidebar tree is keyboard-reachable for *actions* — Shift+F10 opens a row's
context menu (FEAT-0071) — but not for *movement*: getting from one row to
another still needs the mouse. A keyboard-only user can open a note by tabbing
to its row and pressing Enter, but only by tabbing through every row above it,
and cannot expand or collapse a folder from the keyboard at all. This closes
that gap by making the tree a standard keyboard-navigable `tree` widget: arrow
keys move focus between rows and expand/collapse folders, with a roving tab
stop so the tree is a single Tab stop rather than one per row. It completes the
keyboard story FEAT-0071 began; it adds no new file operation.

## Behavior

The tree behaves as the conventional ARIA `tree` pattern over its *visible*
rows — a collapsed folder's children exist in the DOM but are `hidden`
(FEAT-0043), and hidden rows are skipped by every movement below.

- **Down / Up** move focus to the next / previous visible row, in the order the
  tree is drawn (a folder header, then its visible children, then the next
  sibling). Movement stops at the ends — Down on the last visible row and Up on
  the first are no-ops (no wrap).
- **Right** on a collapsed folder expands it (its children become visible);
  **Right** on an already-expanded folder moves focus to its first child;
  **Right** on a note does nothing.
- **Left** on an expanded folder collapses it; **Left** on a collapsed folder,
  or on a note, moves focus to its parent folder's header (a no-op at the root,
  where there is no parent).
- **Home / End** move focus to the first / last visible row.
- **Enter / Space** activate the focused row: open the focused note, or toggle
  the focused folder's expansion — the same thing clicking the row does.

Focus uses a **roving tabindex**: exactly one row is in the tab order
(`tabindex="0"`) at a time and the rest are `tabindex="-1"`, so one Tab press
enters the tree at the current row and the next Tab leaves it. The tab stop is
the row that last had focus; on first render (and after a re-render) it is the
active note's row, or the first row when no row is active. Moving focus with the
keys above carries the tab stop to the newly focused row.

Expanding or collapsing a folder from the keyboard runs the exact same toggle
and persistence a header click already does (FEAT-0043's `onToggleFolder`), so a
folder's expanded/collapsed state set by keyboard survives a reload identically.

## Constraints

- No new file-system operation and no note-file write: this milestone only
  moves focus and toggles folder expansion. Creating/deleting/moving/renaming
  stay on the context menu (FEAT-0071), unchanged.
- The keys are handled only when focus is within the tree; they never fire while
  the editor, a dialog, the quick switcher, or any other surface holds focus.
- Exactly one tree row is Tab-focusable at any moment (roving tabindex); a large
  vault never turns the tree into hundreds of sequential tab stops.
- Movement skips rows inside a collapsed folder (they are not reachable until
  their ancestor is expanded), and never wraps past the first/last visible row.
- Expand/collapse goes through the existing FEAT-0043 toggle + persistence, not
  a second, divergent path.
- Right-click / long-press / Shift+F10 context-menu behavior (FEAT-0071) is
  unchanged; a keyboard-opened menu still returns focus to its row on close
  (FEAT-0071/AC-8), and that row is the roving tab stop.

## Out of scope

- Typeahead (typing a letter to jump to a matching row).
- Multi-select or range-select of rows.
- Any touch-specific gesture — this is the keyboard story; touch reaches
  actions via long-press (FEAT-0071) and movement via scrolling.
- Reordering rows (the tree is always alphabetical — FEAT-0024).

## Acceptance criteria

**AC-1** — Down/Up move between visible rows in draw order.
Given the sidebar tree has focus on a row, and there are rows above and below it
that are visible,
When the user presses Down (or Up),
Then focus moves to the next (or previous) visible row in the tree's draw order,
and the moved-to row becomes the sole Tab-focusable row.

**AC-2** — Down/Up do not wrap at the ends.
Given focus is on the last visible row (or the first),
When the user presses Down (or, on the first, Up),
Then focus stays where it is — there is no wrap-around.

**AC-3** — A collapsed folder's children are skipped.
Given a collapsed folder with notes beneath it, and a visible row after the
folder,
When the user presses Down while focused on the collapsed folder's header,
Then focus moves to the next *visible* row (the folder's sibling/successor), not
to a child hidden inside the collapsed folder.

**AC-4** — Right expands a collapsed folder, then descends.
Given focus is on a collapsed folder's header,
When the user presses Right,
Then the folder expands (its children become visible); and pressing Right again,
now that it is expanded, moves focus to its first child. Right on a note does
nothing.

**AC-5** — Left collapses an expanded folder, else moves to the parent.
Given focus is on an expanded folder's header,
When the user presses Left,
Then the folder collapses; and given focus is on a collapsed folder or a note
inside a folder, pressing Left moves focus to its parent folder's header (a
no-op at the root).

**AC-6** — Home/End jump to the first/last visible row.
Given the tree has focus,
When the user presses Home (or End),
Then focus moves to the first (or last) visible row, which becomes the sole
Tab-focusable row.

**AC-7** — Enter/Space activate the focused row.
Given focus is on a note row (or a folder header),
When the user presses Enter or Space,
Then the note opens in the editor (or the folder toggles its expansion) — the
same result clicking that row gives.

**AC-8** — The tree is a single roving tab stop.
Given a tree with several rows,
When the user tabs into the sidebar and then tabs again,
Then exactly one row was Tab-focusable (the active note's row, or the first row
when none is active) and the second Tab leaves the tree — the tree is not one
tab stop per row.

**AC-9** — Keyboard expand/collapse persists like a click.
Given the user expands or collapses a folder using Right/Left (or Enter/Space),
When the vault is reloaded,
Then that folder's expanded/collapsed state is restored, identically to having
toggled it with a mouse click (FEAT-0043).

**AC-10** — Navigation writes no note file.
Given any sequence of Up/Down/Left/Right/Home/End/Enter/Space in the tree,
When the sequence has run,
Then no note file has been created, modified, or deleted — only focus moved and
folder-expansion state (which is not a note file) changed.
