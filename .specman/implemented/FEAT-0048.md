---
id: FEAT-0048
title: settings modal and local-font access
status: draft
depends_on: [FEAT-0047]
---

## Intent

M16 P1 (FEAT-0047) built the settings engine: the model, `.brulion.json`
persistence, and `applySettings`. This phase adds the **visible surface** — the
settings modal with its four controls, the two entry points, and the local-font
picker — so the preferences are reachable and editable, not just file-backed.

A new settings modal hosts: **font**, **text size**, **editor width**, and the
**Vim toggle** (relocated from the header). Every change is applied live and
persisted through the P1 path (`updateSettings` → `applySettings` + `saveSettings`),
so the modal never owns settings state — it reads the current settings to populate
its controls and reports changes back. Two entry points open it: a **gear icon** in
the header (which replaces the now-removed header Vim button) and **`Ctrl/Cmd+,`**.

The **font control** enumerates installed fonts via `queryLocalFonts()` behind a
one-time permission (Chromium-only, consistent with the FSA-only stance). When the
API is unavailable (non-Chromium) or permission is denied, it falls back to a small
**curated preset list**. Either way the user **selects** a family — never free-types
a font name — and the chosen family becomes the primary face of an ordered stack
with the generic floor auto-appended (the P1 `buildFontStack`). The `Ctrl/Cmd+;` Vim
shortcut (FEAT-0021) is unchanged and keeps working alongside the modal's toggle.

## Behavior

**The modal and its controls.** A modal dialog (same backdrop/`role="dialog"`
pattern as the quick switcher and conflict modals) presents four controls, each
seeded from the current settings when the modal opens:
- **Font** — a select whose first option is the built-in default (maps to an empty
  font list) followed by the available family names; choosing one sets the font to
  that single family, choosing the default clears it.
- **Text size** — a stepper (decrement / readout / increment, or an equivalent
  number control) bounded to 12–24px; it cannot move outside that range.
- **Editor width** — a three-way choice (Narrow / Wider / Full) reflecting the
  current preset, exactly one selected.
- **Vim** — a checkbox/toggle reflecting whether Vim is on.

**Live apply + persist.** Changing any control reports a settings patch to the host,
which applies it to the editor and writes `.brulion.json` immediately (the P1
`updateSettings`). There is no separate "Save" button and no "Cancel/revert" — edits
take effect as made, consistent with the single-source-of-truth model.

**Entry points.** A gear button in the header opens the modal; so does `Ctrl/Cmd+,`
(capture-phase, preventing the browser default, only once a folder is open). The
modal closes on Esc, on a backdrop click, and on an explicit close control. The
header's Vim button is **removed** — the gear takes its header slot, and Vim is
toggled from inside the modal (or via the unchanged `Ctrl/Cmd+;`).

**Staying in sync.** While the modal is open, a settings change made elsewhere
(notably the `Ctrl/Cmd+;` Vim shortcut) is reflected in the modal's controls, so the
displayed state never disagrees with the live state.

**Local-font access.** Opening the font control (or the modal) resolves the list of
selectable families: if `queryLocalFonts` exists, it is called (prompting the
one-time permission) and the installed family names are offered, de-duplicated and
ordered; if the function is absent or the call is denied/throws, a curated preset
list of common cross-OS families is offered instead. The user picks from whichever
list; there is no text entry for a font name. The currently-chosen family is shown
as selected even if it is not in the resolved list (so a font chosen on another
machine still displays).

## Constraints

- **The modal owns no settings state.** It reads the current settings to populate
  controls and emits change patches; persistence and application stay in the P1
  layer. *Why:* one source of truth (`.brulion.json`), no drift between a modal copy
  and the file.
- **Selection only for fonts — never free text.** A font is always chosen from a
  resolved list (local or preset). *Why:* a free-typed name silently fails when the
  font is absent; selection keeps the stack meaningful, and the generic floor
  guarantees a usable fallback.
- **Font access degrades, never errors.** A missing `queryLocalFonts`, a denied
  permission, or a thrown call must yield the preset list, not a broken control.
- **Moat: untouched.** Pure UI over the P1 engine; the only write is the
  already-specified `.brulion.json` settings write. No note `.md` bytes change.
- **Keyboard parity.** `Ctrl/Cmd+,` opens the modal and `Ctrl/Cmd+;` still toggles
  Vim, both regardless of focus, without being swallowed by CodeMirror/Vim — same
  capture-phase discipline as the existing shortcuts.
- **Lean.** The font control sets a single primary family (plus the auto floor); the
  model already supports a longer ordered stack, but the v1 UI does not build a
  multi-font reorderable stack.

## Out of scope

- **A multi-font, reorderable stack builder** — the model (`font: string[]`)
  supports it, but the UI exposes choosing one primary family. Deferred unless
  wanted.
- **Theme (light/dark)** — M18; it slots into this same modal later.
- **Sidebar width and default folder-collapse** — owned by M13 (drag / sidebar
  behavior), deliberately not in this appearance modal.
- **Persisting the font-access permission decision** — the browser owns the
  `queryLocalFonts` permission lifetime; the app re-resolves on demand.

## Acceptance criteria

**AC-1** — The gear icon opens the modal.
Given a folder is open,
When the user clicks the header gear icon,
Then the settings modal appears with its four controls seeded from the current
settings.

**AC-2** — `Ctrl/Cmd+,` opens the modal.
Given a folder is open,
When the user presses `Ctrl/Cmd+,`,
Then the settings modal opens (the browser's default for that chord is prevented).

**AC-3** — Changing text size applies live and persists.
Given the modal is open,
When the user increases the text size,
Then the editor's base font size grows immediately and `.brulion.json` records the
new size; the control cannot be pushed outside 12–24.

**AC-4** — Changing the editor width applies live and persists.
Given the modal is open,
When the user picks a different width preset,
Then the editor's content measure changes immediately and `.brulion.json` records
the new preset.

**AC-5** — The Vim toggle in the modal applies live and persists, and stays in sync.
Given the modal is open with Vim off,
When the user turns the modal's Vim toggle on,
Then Vim mode turns on in the editor and `.brulion.json` records `vim: true`; and
when Vim is toggled via `Ctrl/Cmd+;` while the modal is open, the modal's toggle
reflects the change.

**AC-6** — The header Vim button is gone; the gear is in its place.
Given a folder is open,
When the header is shown,
Then there is no Vim button in the header; the gear (settings) control is present,
and `Ctrl/Cmd+;` still toggles Vim.

**AC-7** — The font control lists local fonts, or presets when unavailable.
Given a folder is open,
When the user opens the font control and `queryLocalFonts` is available and granted,
Then the installed families are offered for selection; and when `queryLocalFonts` is
absent or denied, a curated preset list is offered instead — in both cases by
selection only, never free text.

**AC-8** — Choosing a font applies live and persists as a stack with a floor.
Given the modal is open,
When the user selects a non-default family,
Then the editor's font changes to that family with the generic fallback appended,
and `.brulion.json` records the chosen family; selecting the default again clears the
override.

**AC-9** — The modal closes by Esc and backdrop.
Given the modal is open,
When the user presses Esc or clicks the backdrop,
Then the modal closes and the editor is interactive again.
