---
id: FEAT-0033
title: quick switcher and note creation
status: draft
depends_on: [FEAT-0011, FEAT-0012, FEAT-0023]
---

## Intent

Finding and creating notes today means reaching for the sidebar: scanning the
tree to switch, or typing into a small inline textbox to create. Both are
mouse-or-aim heavy and the create textbox is poor UX (a bare field whose only
feedback is an error line). This phase adds a single keyboard-first surface — a
quick switcher opened with `Ctrl+K` / `Cmd+K` — that fuzzy-finds an existing note
*and* creates a new one by name, and removes the inline-create textbox so there is
one obvious way to create.

The switcher is pure interaction over the existing note model: it reads the
in-memory note list and calls the existing switch/create operations. The only disk
write it can cause is the note the user explicitly creates — the same write the
old textbox performed, through the same validated path. The file-fidelity moat is
otherwise untouched.

## Behavior

`Ctrl+K` (or `Cmd+K` on macOS) opens a centered modal overlay over the workspace:
a single text input with a results list beneath it. It opens regardless of editor
focus or Vim mode/state, with the input focused.

**Filtering.** The results rank the known note paths by a fuzzy match of the typed
query (a subsequence match, best matches first; ties broken by name). An empty
query lists all notes. Matching is over the note's display path (no `.md`), case
-insensitively.

**Navigation.** ↑/↓ move the highlighted result (wrapping is not required); Enter
opens the highlighted note; a mouse click on a result opens it too. Opening a note
routes through the existing switch path and closes the overlay. `Esc`, or a click
on the backdrop outside the dialog, closes the overlay with the open note
unchanged.

**Create-on-miss.** When the query matches no existing note, the list shows a
"Create «query»" row (selectable like any result). Choosing it normalizes the
query with the same validator note creation already uses (`normalizeNoteName`,
which also handles `folder/name` subpaths) and creates + opens the note. If the
query already names an existing note, that note is offered to *open*, not
recreated. If the name is invalid, an inline message is shown in the overlay and
nothing is created. Creation goes through the existing non-clobbering create, so
the Create row never silently overwrites.

**Removal of the inline-create textbox.** The sidebar `#new-note` form/input and
its `wireNewNote` wiring are removed; creating a note is done through the switcher.
The sidebar keeps the note tree (list/switch/delete) unchanged.

## Constraints

- **Reuse the note model.** Switching uses the existing switch operation; creating
  uses the existing create operation and `normalizeNoteName` validator — no second
  create/validation path.
- **No new dependency.** The fuzzy match is a small in-repo function; no search
  library is added.
- **Follow the existing modal pattern.** The overlay mirrors the conflict modal's
  backdrop/dialog structure and `[hidden]` toggling, reusing the existing styling
  vocabulary.
- **Opens under Vim.** The shortcut must open the switcher with Vim on, in normal
  or insert mode (it is not swallowed by the editor/Vim key handling).
- **Moat: no writes except the explicit create.** Opening, filtering, navigating,
  and closing the switcher write nothing to the folder.

## Out of scope

- **Full-text/content search** — the switcher matches note names/paths, not body
  text.
- **A general command palette** (rename/delete/settings actions) — note find and
  create only.
- **Recency/frecency ordering** — ranking is by match quality and name; no usage
  history is introduced.

## Acceptance criteria

**AC-1** — The shortcut opens the switcher, focused.
Given a folder is open,
When the user presses `Ctrl+K` (or `Cmd+K`),
Then a modal overlay appears with a text input that has focus and a results list
showing the notes.

**AC-2** — Typing fuzzily filters the notes.
Given the switcher is open with several notes,
When the user types a query,
Then the results narrow to notes whose display path fuzzily matches the query,
best matches first, and a non-matching query removes all note results.

**AC-3** — Arrow keys and Enter open the highlighted note.
Given the switcher is open and filtered to at least one note,
When the user moves the highlight with ↑/↓ and presses Enter,
Then the highlighted note becomes the open note and the overlay closes.

**AC-4** — A click opens a note.
Given the switcher is open,
When the user clicks a note result,
Then that note becomes the open note and the overlay closes.

**AC-5** — Esc (or backdrop) closes without changing the note.
Given the switcher is open and a note is currently open,
When the user presses Esc or clicks the backdrop outside the dialog,
Then the overlay closes and the open note is unchanged.

**AC-6** — A no-match query offers Create, and Enter creates + opens it.
Given the switcher is open and the query matches no existing note,
When the user selects the "Create «query»" row (Enter),
Then a note with that (normalized) name is created and opened, and the overlay
closes.

**AC-7** — An invalid create name is rejected inline.
Given the switcher is open and the query is not a valid note name,
When the user tries to create it,
Then an inline message is shown in the overlay and no note is created.

**AC-8** — The sidebar inline-create textbox is gone.
Given a folder is open,
When the user looks at the sidebar,
Then there is no inline new-note input; note creation is reached through the
switcher, while the note tree (switch/delete) is unchanged.

**AC-9** — The switcher opens with Vim on.
Given Vim mode is on (in normal or insert mode),
When the user presses `Ctrl+K`/`Cmd+K`,
Then the switcher opens as usual (the shortcut is not swallowed by Vim).

**AC-10** — No writes except the explicit create.
Given a folder is open,
When the user opens the switcher, filters, navigates, and closes it without
choosing Create,
Then nothing is written to the folder.
