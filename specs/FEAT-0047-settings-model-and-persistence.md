---
id: FEAT-0047
title: settings model and persistence
status: draft
depends_on: [FEAT-0021]
---

## Intent

M16 gives Brulion a single home for preferences (font, text size, editor width,
Vim). This phase builds the **engine** under that home — everything except the
modal UI: the settings data model, its on-disk persistence, and the function that
applies settings to the live editor. Wiring it into folder-open and the existing
`Ctrl/Cmd+;` Vim shortcut makes the milestone functional before the modal lands.

Settings live in **`.brulion.json` at the open folder's root**, so they travel with
the vault across machines and OSes — consistent with the file-fidelity moat (the
preferences are the user's, in the user's folder, as plain readable JSON). There is
**no idb cache and no "defaults vs current" concept**: the file is the single source
of truth, read fresh on each folder open; before any folder is open, the built-in
defaults apply.

`.brulion.json` is an **opaque, non-`.md` file**. `listNotes` already collects only
`.md` files, so the settings file never appears in the note list and never trips the
M4 poller — this phase relies on (and verifies) that existing filter rather than
adding new exclusion code.

This phase also **migrates the Vim preference off idb**: FEAT-0021 stored Vim in the
`brulion:vim` idb key; it now lives in `.brulion.json`, so Vim travels with the
vault like the other settings. The `Ctrl/Cmd+;` shortcut and the in-place
`setVimMode` reconfigure are unchanged in behavior — only the storage moves.

## Behavior

**The settings model.** A `Settings` value has four fields: `font` (an ordered list
of font-family names, empty meaning "use the built-in default stack"), `textSize` (a
pixel size), `editorWidth` (`"narrow"` | `"wider"` | `"full"`), and `vim` (boolean).
`DEFAULT_SETTINGS` is `{ font: [], textSize: 16, editorWidth: "narrow", vim: false }`
— matching today's hard-coded editor (16px base, 68ch measure, the CSS default font
stack, Vim off).

**Defensive normalization.** `normalizeSettings(raw)` turns arbitrary parsed JSON
into a valid `Settings`: missing or wrong-typed fields fall to their default;
`textSize` is rounded and clamped to 12–24; `editorWidth` must be one of the three
literals or it falls to `"narrow"`; `font` keeps only string entries (a non-array,
or non-string entries, drop to `[]`/are filtered); `vim` is coerced to a boolean. So
a hand-edited, truncated, or stale file can never throw or mis-apply — the worst case
is defaults.

**The font stack.** `buildFontStack(fonts)` produces a CSS `font-family` value:
each family that needs quoting (contains a space or a non-identifier character) is
wrapped in quotes, the families are comma-joined in order, and a **generic family
floor** (`sans-serif`) is always appended last so there is a usable font on every
OS. An empty `fonts` yields the generic floor alone (callers treat empty as "leave
the CSS default in place").

**Persistence.** `loadSettings(dir)` reads `.brulion.json` from the folder root and
returns `normalizeSettings` of its parsed contents; an absent file or invalid JSON
yields `DEFAULT_SETTINGS` (never throws). `saveSettings(dir, settings)` writes the
settings as pretty-printed JSON to `.brulion.json` at the root. Reads and writes
touch only that one root-level file.

**Applying settings.** `applySettings(view, settings)` makes the editor reflect a
`Settings`:
- sets `--editor-font-size` to `${textSize}px` and `--editor-measure` to the width
  the preset maps to (Narrow→`68ch`, Wider→`90ch`, Full→`none`) on the document
  root;
- sets `--font-stack` to `buildFontStack(font)` when `font` is non-empty, and
  **removes** the inline override when `font` is empty (so the stylesheet's default
  `--font-stack` applies — one source of truth for the default);
- toggles Vim through the existing `setVimMode(view, vim)`.

The editor theme reads `--editor-font-size` for its base size and `--editor-measure`
for the content max-width; headings already use `em`, so changing the base size
scales the whole H1/H2/H3 hierarchy proportionally with no extra work.

**Integration.** Opening a folder loads its settings and applies them before the
first paint of that folder's content. The `Ctrl/Cmd+;` shortcut now flips
`settings.vim`, persists the file, and re-applies — replacing the old idb
`saveVimMode`/`loadVimMode` path, which is removed. With no folder open, the
defaults are in effect.

## Constraints

- **File is the single source of truth.** No idb caching of settings, no merge of a
  "stored" vs "current" — `loadSettings` reads the file each folder open and that is
  the state. The only persisted copy is `.brulion.json`.
- **Total, pure model functions.** `normalizeSettings`, `buildFontStack`, and the
  preset→measure mapping are pure and total — any input yields a valid result, never
  a throw. `loadSettings` swallows read/parse errors into `DEFAULT_SETTINGS`.
- **Moat: bytes are the user's.** `.brulion.json` is plain, readable, pretty-printed
  JSON in the user's folder; nothing about a note's `.md` bytes changes. The file is
  opaque to the note layer (the `.md` filter already excludes it — verified, not
  re-implemented).
- **Apply is idempotent and reversible.** Calling `applySettings` with defaults
  restores the built-in look (removing the font override, 16px, 68ch); applying any
  settings then applying defaults leaves no residue.
- **Vim storage moves, behavior holds.** The `brulion:vim` idb key and its
  accessors are removed; Vim's in-place toggle (`setVimMode`) and the `Ctrl/Cmd+;`
  chord behave exactly as in FEAT-0021 — only where the preference is stored changes.

## Out of scope

- **The settings modal UI** and its entry points (gear icon, `Ctrl/Cmd+,`) —
  FEAT-0048 (M16 P2).
- **Local-font enumeration** (`queryLocalFonts`) and the curated preset fallback —
  FEAT-0048; this phase only defines/applies a font stack it is given.
- **Per-control validation UI** — normalization is silent and value-level here;
  surfacing it to a user is the modal's concern (P2).
- **Migrating other idb UI state** (sidebar collapse/width, expanded folders,
  recency) into the file — those stay in idb; only Vim moves, because only Vim is
  part of the settings home M16 defines.

## Acceptance criteria

**AC-1** — Settings load from the folder and apply on open.
Given a folder whose root holds a `.brulion.json` with a non-default text size,
width, and `vim: true`,
When the folder is opened,
Then the editor's base font size, content measure, and Vim mode reflect that file.

**AC-2** — An absent or malformed settings file falls back to defaults.
Given a folder with no `.brulion.json` (or one containing invalid JSON / out-of-range
values),
When the folder is opened,
Then no error is thrown and the editor uses the defaults (16px, 68ch, default font
stack, Vim off) — out-of-range values are clamped, not honored.

**AC-3** — `normalizeSettings` clamps and validates every field.
Given arbitrary parsed JSON (text size above 24 or below 12, an unknown width
string, a `font` that is not an array of strings, a non-boolean `vim`),
When it is normalized,
Then text size is rounded and clamped into 12–24, width falls back to `"narrow"`,
`font` becomes a string-only array (or empty), and `vim` becomes a boolean.

**AC-4** — `buildFontStack` quotes as needed and appends a generic floor.
Given a font list mixing single-word and multi-word family names,
When the stack is built,
Then multi-word families are quoted, single-word ones are not, order is preserved,
and `sans-serif` is appended as the final fallback.

**AC-5** — Save then load round-trips through the file.
Given a non-default `Settings`,
When it is saved to a folder and that folder's settings are loaded again,
Then the loaded value equals the saved one.

**AC-6** — The `Ctrl/Cmd+;` shortcut toggles Vim and persists to the file.
Given a folder is open with Vim off,
When the user presses `Ctrl/Cmd+;`,
Then Vim mode turns on in the editor and `.brulion.json` records `vim: true` (and the
idb `brulion:vim` key is no longer used).

**AC-7** — The settings file is invisible to the note layer.
Given a folder whose root holds `.brulion.json`,
When the note list renders and the poller runs,
Then `.brulion.json` appears in neither — it is never listed as a note and never
treated as an external note change.
