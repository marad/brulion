---
id: FEAT-0020
title: Collapsible note sidebar
status: draft
depends_on: [FEAT-0011]
---

## Intent

The note list (FEAT-0011) sits in a left sidebar that is always visible once a
folder is open. For focused writing — the quick-capture core of the product — the
list is noise: the user wants the editor alone, edge to edge. There is currently
no way to get it out of the way.

This phase adds a way to collapse the sidebar to an editor-only view and bring it
back, and remembers that choice across reloads so the user's preferred working
mode sticks. It is pure UI state — nothing is written to the user's folder (the
file-fidelity moat is untouched); the collapsed flag lives in the same
browser-local persistence the app already uses for the folder handle and the
active note.

## Behavior

A toggle control collapses and restores the sidebar. Collapsing hides the note
list and its new-note field and lets the editor take the full width; restoring
brings the sidebar back. The control stays reachable in both states (it does not
live inside the part that gets hidden), so the user can always re-open the list.
A keyboard shortcut toggles the same state, and it must not collide with the
existing editor shortcuts (Ctrl+B/I/E, Ctrl+↑/↓, Ctrl+Shift+1/2/3, Ctrl+U) or the
markdown-aware Enter.

The collapsed/expanded choice is persisted browser-side (the existing
`idb-keyval` layer, alongside the folder handle and active note — one persistence
mechanism, not a second one) and re-applied on the next load, so the sidebar
comes back in the state the user left it.

Collapse is **orthogonal to the folder-open state**. The sidebar is already hidden
before any folder is open (FEAT-0011); collapse is a separate user preference
expressed as its own state, so the two never fight: opening a folder reveals the
sidebar only when the user has not collapsed it, and toggling collapse while no
folder is open just records the preference for when one is.

## Constraints

- **No writes to the user's folder.** The collapsed flag is browser-local state
  only; the on-disk markdown is untouched.
- **Reuse the existing persistence layer** (`idb-keyval`, `brulion:` keys in
  `session.ts`) rather than introducing a second storage mechanism.
- **No shortcut collision.** The toggle key must not shadow an existing editor
  binding or the slash menu.
- **Lean.** A single boolean of state; a CSS class for the collapsed layout, kept
  separate from the `hidden` attribute that already encodes folder-open.

## Out of scope

- **Resizable / draggable sidebar width** — collapse is one boolean, not a layout
  manager.
- **Remembering width, scroll position, or per-note layout.**
- **Animating the collapse** — a transition is polish, not part of the promise.

## Acceptance criteria

**AC-1** — A control collapses and restores the sidebar.
Given a folder is open and the sidebar is visible,
When the user activates the toggle control,
Then the sidebar (note list + new-note field) is hidden and the editor takes the
full width; activating it again restores the sidebar.

**AC-2** — The toggle stays reachable when the sidebar is collapsed.
Given the sidebar is collapsed,
When the user looks for the way back,
Then the toggle control is still present and visible (it is not inside the
hidden sidebar), so the sidebar can be restored.

**AC-3** — A keyboard shortcut toggles the sidebar without clashing.
Given the editor has focus,
When the user presses the sidebar-toggle shortcut,
Then the sidebar collapses/restores, and none of the existing editor shortcuts
(bold/italic/code, heading level, direct heading, underline) or Enter handling
change their behavior.

**AC-4** — The collapsed state persists across a reload.
Given the user has collapsed (or restored) the sidebar,
When the page is reloaded and the folder re-opens,
Then the sidebar comes back in the same collapsed/restored state the user left it.

**AC-5** — Collapse does not write to the user's folder.
Given the user toggles the sidebar,
When the toggle is recorded,
Then nothing is written to the open folder — only browser-local state changes.

**AC-6** — Collapse and folder-open state are independent.
Given the user has collapsed the sidebar,
When a folder is opened (or the note list changes),
Then the sidebar stays collapsed (the list does not force itself back open); and
given the sidebar is not collapsed, opening a folder reveals it as before.
