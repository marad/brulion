---
id: FEAT-0024
title: Folder tree sidebar
status: draft
depends_on: [FEAT-0023, FEAT-0011, FEAT-0012]
---

## Intent

FEAT-0023 made the storage layer return notes as folder-relative paths
(`sub/b.md`), but the sidebar still renders them as a flat list — a note in a
subfolder shows up as the literal string `sub/b`, with no grouping and no way to
tell structure from names. This phase turns that flat path list into a **tree**:
folders as headers, their notes nested beneath, folders collapsible with the
state remembered. It also closes the create loop — typing `folder/name` in the
new-note field puts the note in that subfolder (the storage layer already
supports it; the UI just has to pass the value through and render the result).
The folder tree on disk is the single source of truth, so the UI tree is derived
fresh from the listing every render — no stored tree, no sidecar.

## Behavior

**Deriving the tree.** A pure function `buildNoteTree(paths)` turns the sorted
flat path list from `listNotes` into a nested structure: notes whose path has no
`/` are root notes; a path with folder segments contributes a folder (and nested
folders) holding the note. Folders and notes are kept in the listing's order
(already case-insensitively sorted by full path). The function is pure (no DOM)
so it is unit-tested directly; it is the only place the flat list becomes a tree.

**Rendering.** The sidebar renders the tree: each folder is a header row showing
the folder's own segment name, with a disclosure control, and its child folders
and notes indented beneath it; root-level notes render at the top level as
before. A note row is unchanged from FEAT-0011/0012 — a name button (display name
drops `.md`) plus a delete button — and `onSelect`/`onDelete` still receive the
note's **full path**. The active note's row is marked (`active` + `aria-current`)
wherever it sits in the tree.

**Collapsing.** Clicking a folder's disclosure toggles its children
hidden/shown. The set of collapsed folder paths is persisted (via the existing
`idb-keyval` layer) and restored on the next render, so the tree opens the way
the user left it. As a usability rule, the **ancestor folders of the active note
always render expanded** regardless of the persisted set — so a freshly created
or restored nested note is never hidden behind a collapsed folder — without
mutating what's persisted.

**Creating into a subfolder.** The new-note field accepts a path: submitting
`projects/diablo` creates `projects/diablo.md` (creating `projects/` if needed,
per FEAT-0023) and opens it. Invalid paths are rejected with the existing
inline error (FEAT-0012 wiring, now with FEAT-0023's path validation).

**Deleting.** Deleting a note removes its file (FEAT-0023). When that was the
last note in a folder, the folder has nothing left to list, so it simply stops
appearing on the next render — there is no separate "delete folder" action and no
empty-folder bookkeeping.

## Constraints

- The tree is derived from the listing every render; no tree/index is stored
  (the folder tree on disk stays the single source of truth — the moat).
- `buildNoteTree` is pure (no DOM/FSA) and unit-tested.
- `onSelect`/`onDelete` carry the full relative path, not the leaf — the
  controller addresses notes by path (FEAT-0023).
- Collapsed-state persistence reuses `idb-keyval`, matching FEAT-0020/0021; no
  new storage mechanism.
- No regression to flat folders: a folder with only root-level notes renders
  exactly as the FEAT-0011 flat list did.

## Out of scope

- Links between notes — FEAT-0025.
- Renaming/moving notes or folders; drag-and-drop; a standalone "new folder"
  button (folders are implied by note paths, per the milestone).
- Showing empty folders (a folder with no `.md` under it does not exist in the
  listing, so it cannot be shown).

## Acceptance criteria

**AC-1** — Build a nested tree from a flat path list.
Given the paths `["a.md", "sub/b.md", "sub/deep/c.md", "sub/d.md"]`,
When `buildNoteTree` is called,
Then it returns a structure with `a` as a root note and a `sub` folder containing
note `b`, note `d`, and a `deep` folder containing note `c`, preserving the
listing order.

**AC-2** — Render folders as headers with notes nested beneath.
Given a tree with a root note and a `sub` folder containing a note,
When the list is rendered,
Then there is a folder header labelled `sub`, the root note renders at top level,
and `sub`'s note renders indented under the `sub` header.

**AC-3** — A note row still selects/deletes by full path.
Given a rendered tree containing `sub/b.md`,
When that note's name button is clicked (and, separately, its delete button),
Then `onSelect` (resp. `onDelete`) is called with `"sub/b.md"`.

**AC-4** — Toggling a folder collapses its children and persists the state.
Given a rendered `sub` folder with its notes visible,
When its disclosure control is clicked,
Then `sub`'s children become hidden and the collapsed state for `sub` is
persisted; rendering again with that persisted state hides `sub`'s children from
the start.

**AC-5** — Ancestors of the active note render expanded regardless of persistence.
Given `sub` is in the persisted collapsed set and the active note is `sub/b.md`,
When the list is rendered,
Then `sub` is shown expanded (so the active note is visible) without changing the
persisted collapsed set.

**AC-6** — The active note is marked wherever it sits.
Given the active note is `sub/b.md`,
When the list is rendered,
Then exactly the `sub/b.md` row carries the active marker (`active` +
`aria-current`).

**AC-7** — Creating with a pathed name makes a subfolder note and opens it.
Given a folder open,
When the user submits `projects/diablo` in the new-note field,
Then `projects/diablo.md` is created (with `projects/` materialized) and becomes
the active note, appearing under a `projects` folder header.

**AC-8** — End-to-end: create into a subfolder, switch, and delete in a browser.
Given the app open on a real folder (OPFS-backed),
When the user creates `sub/one`, creates a root note, switches between them, then
deletes `sub/one`,
Then the nested note appears under a `sub` header, switching loads each note, and
after deleting `sub/one` the `sub` header is gone (no notes left under it).
