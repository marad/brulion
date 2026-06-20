---
id: FEAT-0009
title: Right-click formatting menu
status: draft
depends_on: [FEAT-0007]
---

## Intent

The keyboard shortcuts (FEAT-0007) and slash commands (FEAT-0008) cover the
single-line and discover-by-typing cases. The remaining gap is formatting an
existing **multi-line selection** with the mouse — select a few lines and make
them all headings, or bold a span. This phase adds a right-click popup over the
editor offering Bold, Italic, Code, H1, H2, H3, and Clear formatting, applied
across the whole selection. It is explicitly **not** an always-visible toolbar
(this is not Windows 95) — the menu appears only on demand.

The menu items reuse the same pure transforms as the shortcuts, so there is one
definition of each action and the on-disk result is identical clean markdown.

## Behavior

Right-clicking inside the editor opens a small popup menu at the pointer instead
of the browser's native context menu. The menu lists: **Bold**, **Italic**,
**Code**, **Heading 1**, **Heading 2**, **Heading 3**, **Clear formatting**.

Picking an item applies it to the current selection:

- **Bold / Italic / Code** wrap the selection in the corresponding markers (or
  unwrap if it is already so formatted) — the same toggle as the shortcuts,
  working over a selection that may span lines.
- **Heading 1/2/3** turn **every line touched by the selection** into a heading
  of that level (so selecting five lines and choosing Heading 2 makes all five
  H2).
- **Clear formatting** turns every line touched by the selection back into a
  plain paragraph (strips heading prefixes).

The menu is dismissed when an item is picked, when the user presses Esc, or when
they click outside it. It never persists as a toolbar. Only clean markdown is
written — the actions add/remove standard `*`, `**`, `` ` ``, and `#` characters,
nothing else.

## Constraints

- Reuse the FEAT-0007 transforms (`toggleInline`, heading helpers); do not
  re-derive how to edit the markdown. Heading/clear apply per line across the
  selection.
- Replace the native context menu only inside the editor; elsewhere the browser
  menu is untouched.
- No always-visible toolbar — the menu is on-demand only.
- Dismiss on pick, Esc, or outside click; never leave a dangling popup.
- Only clean CommonMark is written (no HTML, no underline item).

## Out of scope

- A formatting toolbar / bubble menu that appears automatically on selection.
- Submenus, icons, theming of the menu beyond minimal tidy styling.
- Link/list/quote formatting items — only bold, italic, code, headings, clear.

## Acceptance criteria

**AC-1** — Right-clicking the editor opens the custom menu, not the native one.
Given the editor has focus with some text,
When the user right-clicks inside it,
Then a popup menu appears listing Bold, Italic, Code, Heading 1, Heading 2,
Heading 3, and Clear formatting (and the browser's native context menu does not
show).

**AC-2** — Heading applies to every line in a multi-line selection.
Given three lines `a`, `b`, `c` are all selected,
When the user opens the menu and picks Heading 2,
Then on disk all three lines are H2 (`## a`, `## b`, `## c`).

**AC-3** — Bold wraps the selection.
Given the word `word` is selected,
When the user opens the menu and picks Bold,
Then the selection is wrapped to `**word**` on disk.

**AC-4** — Clear formatting strips headings across the selection.
Given two heading lines (e.g. `# one`, `## two`) are selected,
When the user opens the menu and picks Clear formatting,
Then on disk both lines are plain paragraphs (`one`, `two`).

**AC-5** — The menu dismisses without acting on Esc / outside click.
Given the menu is open,
When the user presses Esc (or clicks outside the menu),
Then the menu closes and the document is unchanged.
