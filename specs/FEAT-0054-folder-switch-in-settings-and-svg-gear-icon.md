---
id: FEAT-0054
title: folder switch in settings and svg gear icon
status: draft
depends_on: [FEAT-0048]
---

## Intent

Two small follow-ups to the M16 settings modal (FEAT-0048), both surfaced by real
daily use; neither touches file behavior.

First, **folder switching lives in the wrong place.** Today a plain "Switch folder"
button sits in the header next to the note identity and the gear — a header slot
spent on a rare action that clutters the everyday view. Folder switching belongs
with the other preferences, inside the settings modal, so the header stays lean
(note identity + sidebar toggle + gear) and the modal becomes the single home for
"change how/where I work".

Second, **the settings entry-point glyph looks wrong.** The header gear is the
Unicode character `⚙`, which renders inconsistently across OSes and fonts — often a
colored emoji or a boxy shape that "doesn't look like a gear" and clashes with the
monochrome header controls. An inline SVG gear renders identically everywhere and
inherits the header's text color, so the entry point reads as a proper gear on any
machine — which matters for an app meant to be opened on a foreign box.

## Behavior

**Folder section in the modal.** The settings modal gains a **Folder** section at
the bottom (below the existing font / text-size / width / Vim rows). It shows the
**name of the currently open folder** and a **"Switch folder…"** button. Activating
that button runs the *existing* open-folder flow (the native directory picker →
open the chosen folder → reload its notes and its `.brulion.json` settings → persist
the new handle) — the same flow the header button drove, unchanged in substance.

**The modal closes on switch.** Because settings are per-folder, switching folders
reloads the very settings the modal is displaying. To avoid showing the old folder's
state behind the picker, the modal **dismisses** when the user activates "Switch
folder…". Dismissing the native picker (picking nothing) leaves the app on the
already-open folder, exactly as the header button did — no folder change, the
workspace unchanged.

**Header loses the folder button — and gains no replacement.** The header's "Switch
folder" button is **removed**; no folder name or other folder indicator takes its
place. The open folder's name is visible in the settings modal's Folder section when
the user wants it.

**SVG gear entry point.** The header settings button's content is an **inline SVG
gear** (line/stroke style, `currentColor` so it matches the surrounding header text,
sized to sit comfortably among the other header controls) in place of the `⚙`
character. The button's behavior is unchanged: it opens the modal on click, keeps
its `aria-label`/`title` of "Settings" (with the platform-correct `Ctrl/Cmd+,`
shortcut hint), and the `Ctrl/Cmd+,` shortcut itself is untouched.

## Constraints

- **Reuse the open flow, don't fork it.** "Switch folder…" drives the same
  open-folder path the header button drove (`openFolder` → `openNote` → persist).
  *Why:* folder switching, settings reload, URL/poller behavior, and the
  stale-write guards are already correct there; a parallel path would drift.
- **Moat: untouched.** Pure UI relocation + an icon swap. No note `.md` bytes
  change, and the only disk write is the already-specified folder-handle persistence
  and `.brulion.json` reload that the existing flow performs.
- **Metaphor and keyboard unchanged.** The gear stays a gear (no switch to a
  sliders/tune metaphor), and `Ctrl/Cmd+,` opens the modal exactly as before.
- **Lean.** A single Folder section with a name and one button; no per-folder
  history, no recent-folders list, no in-modal folder tree.

## Out of scope

- **A recent-folders / workspaces list** — switching is still one folder at a time
  via the native picker; multi-folder management stays out (backlog "Workspaces").
- **Changing the first-run welcome flow** — the welcome CTA still opens the *first*
  folder; the modal's Folder section only applies once a folder is open (the modal
  is reachable only then).
- **Renaming or relocating the open folder on disk** — switching points the app at a
  different folder; it does not move files.

## Acceptance criteria

**AC-1** — The settings modal has a Folder section naming the open folder.
Given a folder is open,
When the user opens the settings modal,
Then a Folder section shows the open folder's name and a "Switch folder…" button.

**AC-2** — "Switch folder…" runs the open flow and switches the workspace.
Given the settings modal is open,
When the user activates "Switch folder…" and picks a different folder,
Then the app opens the chosen folder — reloading its notes and its `.brulion.json`
settings — and persists it as the current folder, via the same flow the former
header button used.

**AC-3** — Switching folders dismisses the modal.
Given the settings modal is open,
When the user activates "Switch folder…",
Then the modal is dismissed (so the picker is not shown over the old folder's
settings).

**AC-4** — Dismissing the picker changes nothing.
Given the settings modal is open,
When the user activates "Switch folder…" but cancels the native picker,
Then the previously open folder stays open and its workspace is unchanged.

**AC-5** — The header no longer has a folder button or folder indicator.
Given a folder is open,
When the header is shown,
Then there is no "Switch folder" button and no folder-name indicator in the header.

**AC-6** — The settings entry point is an inline SVG gear.
Given a folder is open,
When the header is shown,
Then the settings button renders an inline SVG gear (not the `⚙` Unicode glyph),
inheriting the header text color.

**AC-7** — The gear's behavior and shortcut are unchanged.
Given a folder is open,
When the user clicks the gear or presses `Ctrl/Cmd+,`,
Then the settings modal opens, and the button keeps its "Settings" accessible label.
