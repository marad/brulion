---
id: FEAT-0057
title: Action registry and command palette
status: draft
depends_on: [FEAT-0033, FEAT-0038, FEAT-0021, FEAT-0054]
---

## Intent

Brulion is keyboard-first for *notes* — `Ctrl+K` finds and opens one — but every
other capability (switch folder, toggle Vim, toggle the note list, open settings)
is reachable only by hunting for its button or memorising a bespoke chord. There is
no single, discoverable place to *run an action*. This phase introduces a
first-class **action** concept and a **command palette** that lists the available
actions for fuzzy-search and run, the same way the switcher lists notes.

An action is just `{ id, label, icon?, run() }`: a named, labelled, optionally
iconed thing the user can invoke. Naming the app's existing scattered capabilities
as actions in one registry gives the palette a uniform list to show, and (in P2)
gives a configurable toolbar a uniform list to pin from. This phase is pure
interaction over existing capability — every action's `run()` is a call the app can
already make from a button or shortcut today. The file-fidelity moat is untouched:
opening the palette and running an action writes nothing the corresponding button
wouldn't already write.

## Behavior

**The action model.** An `Action` is `{ id: string; label: string; icon?; run: ()
=> void }`. The host (`main.ts`) builds a registry of the app's invocable
capabilities and exposes them to the palette. The initial set:

- **Go to note…** — opens the quick switcher (FEAT-0033).
- **Switch folder…** — runs the open-folder flow (FEAT-0054), the same action the
  settings modal's Folder section drives.
- **Toggle Vim mode** — flips `settings.vim` (FEAT-0021/0047), the same effect as
  the `Ctrl/Cmd+;` chord and the settings checkbox.
- **Toggle note list** — flips the sidebar (FEAT-0020), the same as the header
  toggle and `Ctrl+\`.
- **Open settings** — opens the settings modal (FEAT-0048).

Folder-switch and the Vim toggle thereby become registered actions (the M30
"migrate onto the action model" goal); their existing entry points keep working and
now route through the same `run()`.

**The palette.** `Ctrl/Cmd+Shift+K` opens a centered modal overlay over the
workspace — a text input with a results list beneath — mirroring the quick
switcher's structure and styling. It opens regardless of editor focus or Vim
mode/state, with the input focused. It opens only when a folder is open, the
conflict modal is not standing, and no other modal (switcher/settings) is already
up — and it does not stack over itself.

**Filtering.** The results rank the registered actions by a fuzzy match of the
typed query against each action's **label**, reusing the same `fuzzyScore`
(FEAT-0038) the switcher uses, best matches first. An empty query lists all actions
(in registry order). A query matching no action shows an empty list.

**Navigation.** ↑/↓ move the highlighted result; Enter runs the highlighted
action; a mouse click on a result runs it too. Running an action closes the overlay
first, then invokes its `run()`. `Esc`, or a click on the backdrop outside the
dialog, closes the overlay without running anything. Closing restores focus to
where it was before opening (e.g. the editor).

**Icons.** An action may carry a Lucide icon node; when present the palette row
shows it beside the label. An action without an icon renders label-only. (The
toolbar consumer of the icon is P2.)

## Constraints

- **Reuse, don't fork, the switcher pattern.** The palette is a new module but
  mirrors the quick switcher's overlay mechanics (backdrop + dialog, `[hidden]`
  toggling, keyboard nav, focus restore, backdrop-click close) and reuses the
  existing `fuzzyScore` — no second fuzzy implementation, no search library.
- **The palette owns no app state.** It reads the action list via a `getActions()`
  dep and calls `run()`; it does not know what any action does.
- **Opens under Vim.** The shortcut opens the palette with Vim on, in normal or
  insert mode (a capture-phase listener, not swallowed by the editor/Vim handling).
- **Gated like the other shortcuts.** Requires a folder open and the conflict modal
  closed; does not stack over an open switcher or settings modal.
- **Moat: no writes.** Opening, filtering, navigating, and closing the palette write
  nothing to the folder; running an action writes only what that action already
  would (e.g. Switch folder may write nothing; none of the initial actions writes a
  note).

## Out of scope

- **The customizable action bar / pinning** — rendering pinned actions in the
  header and the settings surface to choose them is P2 (FEAT-0058).
- **Per-action keybinding customization** — actions keep their existing chords; the
  palette does not assign or remap keys.
- **A plugin/extension action API** — the registry is built in-app from known
  capabilities, not open to third-party registration.
- **Note find/create in the palette** — that stays the quick switcher's job; the
  palette's "Go to note…" action just opens it.

## Acceptance criteria

**AC-1** — The shortcut opens the palette, focused.
Given a folder is open,
When the user presses `Ctrl+Shift+K` (or `Cmd+Shift+K`),
Then a modal overlay appears with a text input that has focus and a results list
showing the registered actions.

**AC-2** — Typing fuzzily filters the actions by label.
Given the palette is open,
When the user types a query,
Then the results narrow to actions whose label fuzzily matches the query, best
matches first, and a non-matching query shows no results.

**AC-3** — Arrow keys and Enter run the highlighted action.
Given the palette is open and filtered to at least one action,
When the user moves the highlight with ↑/↓ and presses Enter,
Then the overlay closes and the highlighted action's `run()` is invoked.

**AC-4** — A click runs an action.
Given the palette is open,
When the user clicks an action result,
Then the overlay closes and that action's `run()` is invoked.

**AC-5** — Esc (or backdrop) closes without running anything.
Given the palette is open,
When the user presses Esc or clicks the backdrop outside the dialog,
Then the overlay closes and no action is run, with focus restored to where it was.

**AC-6** — Folder-switch and Vim toggle are runnable from the palette.
Given the palette is open,
When the user runs the "Toggle Vim mode" action, and separately the "Switch
folder…" action,
Then Vim mode toggles (as the `Ctrl/Cmd+;` chord would) and the open-folder flow
runs (as the settings Folder section would).

**AC-7** — An action's icon shows on its palette row.
Given an action in the registry carries an icon,
When the palette lists it,
Then the row renders that icon beside the label; an action with no icon renders
label-only.

**AC-8** — The palette opens under Vim.
Given Vim mode is on (in normal or insert mode),
When the user presses `Ctrl/Cmd+Shift+K`,
Then the palette opens as usual (the shortcut is not swallowed by Vim).

**AC-9** — The palette is gated and never stacks.
Given a conflict modal is standing, or the switcher or settings modal is already
open, or no folder is open,
When the user presses `Ctrl/Cmd+Shift+K`,
Then the palette does not open.

**AC-10** — No writes from palette use.
Given a folder is open,
When the user opens the palette, filters, navigates, and closes it without running
an action,
Then nothing is written to the folder.
