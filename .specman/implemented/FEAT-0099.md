---
id: FEAT-0099
title: Togglable active-note sidebar focus
status: draft
depends_on: [FEAT-0047, FEAT-0075]
---

## Intent

The sidebar already marks the active note visually and through ARIA, but keyboard
users may want focus to follow genuine note navigation. Make that behavior a
portable vault preference in `.brulion.json`, defaulting to enabled while
retaining an explicit opt-out. Focus must follow navigation only: a background
list repaint or an unchanged active note must never interrupt the editor or a
modal, and the independent collapsed-sidebar choice must remain untouched.

## Behavior

`Settings` gains a `focusActiveNote` boolean. Missing or invalid values normalize
to `true`, and the value round-trips through the existing settings file and is
available in the Settings modal as a labeled checkbox. Toggling it applies live
and persists through the existing settings update path.

When the active note path changes from the previously announced path, and the
preference is enabled, the host reveals the active note's ancestor folders,
focuses the matching `.note-name` row, and asks the scrollable tree to place the
row near its vertical center after the sidebar projection is current. Ancestor
folder expansion is an ordinary persisted expanded-state change; the separate
sidebar collapse choice is not changed. If the preference is disabled, or the
sidebar itself is collapsed/hidden, no programmatic focus or sidebar reveal
occurs; visual active and ARIA state still update. Repainting the same active
note never moves focus or scrolls, and no path changes or settings writes alter
Markdown bytes.

## Acceptance criteria

- AC-1: Given settings JSON with no `focusActiveNote`, an invalid value, `true`,
  or `false`, when settings are normalized and loaded, then missing/invalid
  values become `true`, valid booleans are preserved, and save/load round-trips
  the chosen value through `.brulion.json`.
- AC-2: Given the Settings modal is open, when it is seeded from either value,
  then a labeled active-note-focus checkbox reflects that value; when the user
  toggles it, then the modal emits `{ focusActiveNote: boolean }` and the live
  host can persist the patch.
- AC-3: Given the focus preference is enabled and the active note changes from
  one existing note to another, when the sidebar is visible, then the matching
  visible note row receives DOM focus, has the active visual/ARIA state, and is
  the sole roving `tabindex="0"` row.
- AC-4: Given the editor or a dialog currently has focus, when a poller repaint
  announces the same active note, then DOM focus and sidebar scroll stay where
  they were; given the preference is disabled, an active-note change updates
  visual/ARIA state but does not move DOM focus or scroll; given the sidebar
  itself is collapsed, navigation does not force it open or focus a hidden row.
- AC-5: Given either preference value, when notes are opened, switched, or
  repainted, then no Markdown file is created, modified, or rewritten by the
  focus behavior.
- AC-6: Given the preference is enabled and a genuinely opened note is nested
  below a collapsed folder, when the active-note announcement reaches the
  sidebar, then every ancestor folder is expanded and persisted, the note row
  receives focus, and the sidebar scrolls it toward the vertical center; the
  sidebar's own collapsed state remains unchanged.

## Out of scope

- Automatically opening the sidebar/drawer; folder expansion is part of
  revealing the active note and may update the existing persisted expanded set.
- New note navigation commands, a focus ring redesign, or a second tree model.
- Focusing on mere list membership changes when the active path is unchanged.
