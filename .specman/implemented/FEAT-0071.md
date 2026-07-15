---
id: FEAT-0071
title: Context menu for tree row actions
status: draft
depends_on: [FEAT-0012, FEAT-0069, FEAT-0070]
---

## Intent

FEAT-0069/FEAT-0070 gave folder rows a "+"/"→"/"×" and note rows a "→",
always visible next to the name — on top of the note row's pre-existing "×"
(FEAT-0012). Reviewed live against the real app, that reads as clutter: every
row in the tree carries two-to-four small buttons whether or not the user is
about to act on them. This phase replaces all of them with a single
right-click (and, on touch, long-press) context menu per row — the actions
themselves don't change, only how they're reached. A menu is the conventional
place for "things you can do to this item" in a file tree, and it scales to
more actions later without adding another permanent button to every row.

## Behavior

Right-clicking a note row opens a small menu with two items — **Move…**
(FEAT-0070) and **Delete** (FEAT-0012) — positioned at the click. Right-
clicking a folder row opens one with three — **New subfolder…** (FEAT-0069),
**Move…** (FEAT-0070), **Delete** (FEAT-0069) — same position rule. Choosing
an item runs the exact action its button used to trigger (the same prompt/
confirm/picker flow already built for it); nothing about *what* create/move/
delete do changes here, only how they're invoked. The menu closes when an
item is picked, when Esc is pressed, or when the user clicks outside it —
never left dangling. No row shows an inline action button anymore; the name
(and, for a folder, its disclosure) is the only thing visible on a row until
it's right-clicked or long-pressed.

A long-press (holding a touch point in place past a short threshold, without
dragging) opens the same menu at the touch point, so a touch device — which
has no right-click — still reaches every one of these actions. Moving the
touch point past a small tolerance, or lifting early, cancels the press
without opening anything; a completed long-press does not also trigger the
row's normal tap action (select a note / toggle a folder).

Deferred at first ship, reconsidered after review: a keyboard-only user had
no path in at all (right-click needs a mouse, long-press needs touch). The
standard keyboard-invoked context-menu shortcut — Shift+F10, or a keyboard's
dedicated "Menu"/"ContextMenu" key — opens the same menu for whichever row
currently has focus (a folder header is itself focusable; a note row's
keydown bubbles up from its focusable name button), positioned at that row's
own location rather than a click point.

A menu opened this way must also be *operable* from the keyboard, not just
summoned: focus moves into the menu on open (onto its first item), Up/Down
arrows move between items (wrapping at the ends), Enter/Space activates the
focused item, and Esc closes the menu and returns focus to the row it was
opened from — so a keyboard user is never stranded on a visible-but-unreachable
menu, and never loses their place in the tree afterward. A mouse- or
touch-opened menu is unaffected: it keeps its existing behavior (no forced
focus move), since the pointer is already the way in.

## Constraints

- One right-click (or long-press) always opens exactly the menu for that
  row's kind (note: 2 items; folder: 3 items) — never zero, never a mix.
- A menu item's action is identical to its former button's: the same
  `NoteListHandlers` callback, so the confirm-before-delete and prompt-for-a-
  name flows already built for FEAT-0069/FEAT-0070/FEAT-0012 are reused
  unchanged, not reimplemented.
- Dismiss on pick, Esc, or an outside click — the menu never persists as a
  toolbar and never leaves a stray node/listener behind once closed.
- A long-press that opens the menu suppresses that touch's ordinary tap
  action on the row (no double-firing select/toggle alongside the menu).
- No inline action buttons remain on a note or folder row.

## Out of scope

- A context menu for the tree root / empty sidebar space (creating a
  root-level folder stays the existing header button).
- Submenus, icons, or any styling beyond the existing editor context menu's
  look, which this reuses.

## Acceptance criteria

**AC-1** — Right-clicking a note row opens Move/Delete.
Given a note row in the tree,
When the user right-clicks it,
Then a menu opens at the click position with exactly two items, "Move…" and
"Delete", and no inline button is visible on the row.

**AC-2** — Right-clicking a folder row opens New subfolder/Move/Delete.
Given a folder row in the tree,
When the user right-clicks it,
Then a menu opens with exactly three items, "New subfolder…", "Move…", and
"Delete", and no inline button is visible on the row.

**AC-3** — Choosing a menu item runs the same action its button used to.
Given a note row's context menu is open,
When the user picks "Delete",
Then the same confirm-then-remove flow FEAT-0012's delete button used to
trigger runs (confirmation shown; declining leaves the note; confirming
removes it) — the menu item is a new trigger for old, unchanged behavior.

**AC-4** — The menu dismisses without acting on Esc or an outside click.
Given a row's context menu is open,
When the user presses Esc, or clicks outside the menu,
Then the menu closes and nothing is created, moved, or deleted.

**AC-5** — A long-press on a note or folder row opens its context menu.
Given a touch device (no right-click available),
When the user holds a touch point on a row without moving it past the
tolerance for longer than the long-press threshold,
Then the same menu for that row's kind opens at the touch point, and the
row's normal tap action (select / toggle) does not also fire.

**AC-6** — Moving or lifting early cancels a long-press.
Given a touch point held on a row,
When the user moves it past the tolerance, or lifts it, before the
long-press threshold elapses,
Then no menu opens, and a lift before the threshold behaves as an ordinary
tap (select the note / toggle the folder).

**AC-7** — A keyboard-only user can open the menu too.
Given a note or folder row (or, for a note, its focusable name button)
has keyboard focus,
When the user presses Shift+F10 or the keyboard's dedicated "Menu"/
"ContextMenu" key,
Then the same menu for that row's kind opens, positioned at the row.

**AC-8** — A keyboard-opened menu is fully operable and returns focus on close.
Given a row's context menu was opened from the keyboard (AC-7),
When the menu appears,
Then focus is on its first item; Up/Down arrows move focus between items
(wrapping at the ends); Enter or Space activates the focused item; and Esc
closes the menu and returns focus to the row it was opened from.
