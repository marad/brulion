---
id: FEAT-0009
title: Right-click formatting menu
status: draft
depends_on: [FEAT-0007]
---

## Intent

> **Superseded in part by FEAT-0053 (M17 P3).** This menu originally offered
> formatting (Bold/Italic/Code/H1–H3/Clear) over a selection. That formatting role
> **moved to the selection toolbar** (FEAT-0052/FEAT-0053), which is now the single
> formatting surface on desktop and touch. The right-click menu was reduced to its one
> remaining, position-based item — the **wikilink-form toggle** — and on plain text it
> no longer overrides the browser's native menu. The behavior/ACs below describe the
> *current* (post-FEAT-0053) menu; the original formatting items are gone.

The remaining job of the right-click menu is the one thing a selection-based toolbar
can't do: when the pointer is on a wikilink, offer to **toggle that link's form**
between its full path and its name-only form. This is inherently position-based (which
link you clicked), so it stays a right-click/long-press menu rather than moving to the
toolbar. Its action reuses the same `computeWikilinkToggle` logic as before.

## Behavior

Right-clicking inside the editor opens a small popup menu **only when the click lands
on a wikilink that has a form toggle** (a link to a nested note with a unique
basename). The menu then shows a single item — the form toggle — and choosing it
switches the link between its full-path and name-only forms.

On plain text — or any position with no wikilink toggle — **no custom menu opens**;
the app does not override the browser's native context menu there. Formatting is
reached via the selection toolbar (FEAT-0053) or the `Ctrl` shortcuts (FEAT-0007),
never this menu.

The menu is dismissed when its item is picked, when the user presses Esc, or when
they click outside it. It never persists as a toolbar. Only clean markdown is written
(the toggle rewrites the wikilink's target form, nothing else).

## Constraints

- **Wikilink-toggle only.** The menu hosts exactly the form toggle; no formatting
  items (those live in the FEAT-0053 toolbar). One definition of the toggle
  (`computeWikilinkToggle`).
- **Native menu on plain text.** When there is no wikilink toggle at the click, the
  app does not preventDefault — the browser's native context menu is left to show.
- **On-demand, never a toolbar.** The menu appears only on a right-click/long-press
  over a togglable wikilink.
- **Dismiss on pick, Esc, or outside click; never leave a dangling popup.**
- **Only clean CommonMark is written** by the toggle (no HTML).

## Out of scope

- **Formatting items** — moved to the selection toolbar (FEAT-0053).
- **A touch affordance for the toggle** beyond long-press — deferred (niche).
- **Submenus, icons, theming** beyond minimal tidy styling.

## Acceptance criteria

**AC-1** — Right-clicking a togglable wikilink opens the one-item toggle menu.
Given the pointer is on a wikilink whose form can be toggled,
When the user right-clicks it,
Then a popup menu appears with a single form-toggle item (and the browser's native
menu does not show); choosing it switches the link's form on disk.

**AC-2** — Right-clicking plain text opens no custom menu.
Given the pointer is on plain (non-wikilink) text,
When the user right-clicks,
Then no custom menu opens — the browser's native context menu is left to appear — and
the document is unchanged.

**AC-3** — Formatting is not in this menu.
Given the right-click menu in any case where it opens,
When its items are inspected,
Then it contains no Bold/Italic/Code/Heading/Clear items — formatting is the
selection toolbar's job (FEAT-0053).

**AC-4** — The menu dismisses without acting on Esc / outside click.
Given the menu is open,
When the user presses Esc (or clicks outside the menu),
Then the menu closes and the document is unchanged.
