---
id: FEAT-0021
title: Opt-in Vim mode
status: draft
depends_on: [FEAT-0007, FEAT-0008, FEAT-0018]
---

## Intent

Some writers are far faster with Vim keybindings than with the default editing
model. Brulion's audience is quick-capture, not Vim users by default, so Vim must
be strictly **opt-in** — off until the user asks for it — but available for those
who want it. This phase adds a Vim keybinding layer (`@replit/codemirror-vim`)
behind a toggle, and remembers the choice across reloads.

The hard requirement is that turning Vim on must **not break the editor's own
commands**: the slash menu (FEAT-0008), the format shortcuts (FEAT-0007:
Ctrl+B/I/E, Ctrl+↑/↓, Ctrl+Shift+1/2/3, Ctrl+U), and the markdown-aware Enter
(FEAT-0018) must all still work while editing. With Vim off, the editor must
behave exactly as it does today — no Vim artifacts, no changed keys. As with the
rest of the editor, this is pure interaction state: nothing is written to the
user's folder (the file-fidelity moat is untouched).

## Behavior

A toggle control turns Vim mode on and off; it is off by default. The choice is
persisted browser-side (the existing `idb-keyval` layer, alongside the folder
handle, active note, and sidebar state) and re-applied on the next load.

Vim is wired through a CodeMirror compartment (like the existing read-only
compartment), so toggling reconfigures the editor in place without remounting.
When on, the compartment holds the Vim extension; when off, it holds nothing, so
the editor is byte-for-byte the same configuration as before this phase.

Precedence is the crux. The Vim layer sits at **higher precedence than the
editor's own keymaps**, which yields the correct split:

- In **normal mode**, Vim owns the keys (h/j/k/l motions, `i`/`a` to enter insert,
  Enter to move down, Ctrl+B page-up, etc.) — standard Vim, which is the whole
  point of opting in.
- In **insert mode**, Vim does not bind Enter, `/`, or Ctrl+B/I/E, so those fall
  through to the editor's own handlers: the markdown-aware Enter continues/exits
  lists and quotes, the slash menu opens on `/` and accepts on Enter, and the
  format shortcuts reshape the markdown — exactly as with Vim off.

The toggle control stays reachable regardless of editor state, and a Vim-mode
indicator (the library's own cursor/mode affordance) shows the active mode. The
same toggle is also bound to a keyboard chord (Ctrl/Cmd+Alt+V) so Vim can be
switched on or off without leaving the keyboard; the chord flips the same state and
persistence as the button.

**Visible selection (drawSelection).** Vim hides the browser's native selection so
it can paint its own (block cursor, visual-mode highlight). The editor had been
relying on the native selection — `drawSelection` was dropped in M2 because its
custom layer drew the selection offset from the text. That offset was since
root-caused: it was the scroller's `scrollbar-gutter` reservation throwing off
`drawSelection`'s coordinate math, **not** the hidden-markup `Decoration.replace`
runs as M2 assumed (`coordsAtPos` is accurate over hidden runs). With the gutter
removed, `drawSelection` measures correctly, so it is restored editor-wide and the
native-selection workaround dropped. Consequence: the visual-mode selection is
visible under Vim, and selection rendering stays correct with Vim off (the small
reason the gutter existed — keeping the centered column from shifting when a
scrollbar appears — is given up; the column may shift slightly then).

## Constraints

- **Opt-in, off by default.** A first-time user never sees Vim behavior until they
  enable it.
- **No command regressions.** Slash menu, format shortcuts, and markdown-aware
  Enter keep working with Vim on (insert mode); with Vim off the editor is
  unchanged.
- **Reuse the existing persistence layer** (`idb-keyval`, `brulion:` keys) — one
  mechanism, no second store.
- **Reuse the compartment pattern** already used for the read-only toggle, rather
  than remounting the editor.
- **No writes to the user's folder.** Toggling Vim changes only browser-local
  interaction state.

## Out of scope

- **Vim ex-commands / macros / custom `.vimrc` mappings** — ship the stock
  `@replit/codemirror-vim` behavior; deep customization is not a quick-capture
  need.
- **A Vim-aware rebinding of the slash/format commands** — they are reached in
  insert mode, where Vim leaves them alone; no remapping is added.
- **Relative line numbers / Vim gutter** — the editor stays gutterless.

## Acceptance criteria

**AC-1** — Vim mode is off by default.
Given a user who has never toggled Vim,
When the editor loads,
Then no Vim keybindings are active (e.g. pressing `i` inserts the literal letter,
`j`/`k` do not move the cursor), and the editor behaves as it did before this
phase.

**AC-2** — A control toggles Vim mode on and off.
Given the editor is loaded,
When the user activates the Vim toggle,
Then Vim keybindings become active (a Vim mode indicator appears and motions
work); activating it again returns the editor to the default model.

**AC-3** — The Vim choice persists across a reload.
Given the user has turned Vim on (or off),
When the page is reloaded,
Then Vim mode comes back in the same state the user left it.

**AC-4** — With Vim on, the slash menu still works.
Given Vim mode is on and the cursor is in insert mode at a line start,
When the user types `/` and a command name and presses Enter,
Then the slash menu opens, filters, and the chosen command reshapes the line (the
menu is not swallowed by Vim).

**AC-5** — With Vim on, the format shortcuts still work.
Given Vim mode is on and the cursor is in insert mode with a word selected,
When the user presses Ctrl+B (or Ctrl+I / Ctrl+E),
Then the selection is wrapped in the corresponding markdown (bold/italic/inline
code), exactly as with Vim off.

**AC-6** — With Vim on, the markdown-aware Enter still works.
Given Vim mode is on and the cursor is in insert mode on a bullet item with text,
When the user presses Enter,
Then a new list item is continued (and an empty item exits the list) — FEAT-0018
behavior, not a Vim-inserted newline.

**AC-7** — With Vim on, normal-mode commands are active.
Given Vim mode is on,
When the user presses Esc and then a motion (e.g. `0`/`$` or `j`/`k`),
Then the cursor moves per Vim without inserting text, confirming the Vim layer is
genuinely engaged (not just loaded).

**AC-8** — Toggling Vim does not write to the user's folder.
Given a folder is open,
When the user toggles Vim mode,
Then nothing is written to the open folder — only browser-local state changes.

**AC-9** — With Vim on, the visual-mode selection is visible.
Given Vim mode is on,
When the user enters visual mode and extends a selection over some text,
Then the selection is rendered visibly (a highlight tracks the selected text), not
left invisible while only the underlying selection state changes.

**AC-10** — Selection renders correctly over hidden markup (no offset).
Given a line containing hidden markup (e.g. a heading's `# ` or a `**bold**` span),
When text on that line is selected,
Then the selection highlight aligns with the selected glyphs (it is not drawn
shifted away from the text) — with or without Vim.

**AC-11** — A keyboard chord toggles Vim mode.
Given a folder is open,
When the user presses Ctrl/Cmd+Alt+V,
Then Vim mode toggles on or off exactly as the header button would — the indicator
and the persisted choice track the change — without the chord being swallowed by
the editor or the Vim layer.
