---
id: FEAT-0043
title: Folders collapsed by default
status: draft
depends_on: [FEAT-0024]
---

## Intent

In a large vault the note tree (FEAT-0024) opens fully expanded, so the sidebar
is a wall of every note at every depth. This phase flips the default: the tree
opens **collapsed** — only the top-level rows are shown — and the user expands
the folders they care about, a choice that persists across reloads.

Today persistence stores the set of folders the user *collapsed* (absence =
expanded). With collapsed as the new default that polarity is wrong — an absent
folder must now read as collapsed, and there is no way for a single "collapsed"
set to also record an *expanded* folder. So the persisted set is inverted to hold
the folders the user **expanded** (absence = collapsed). The "reveal the active
note's ancestors" rule from FEAT-0024 is preserved: an ancestor of the open note
always shows, whether or not it is in the expanded set, so the open note is never
hidden behind a collapsed folder.

This is a sidebar-layer change only. No bytes are written to the user's folder —
the expand/collapse state lives in browser-local storage, exactly as the
collapsed set did.

## Behavior

**Render polarity (pure).** A folder node renders **collapsed** unless either it
is present in the persisted *expanded* set, or it is an ancestor of (or equal to)
the active note's path. A folder with no recorded state renders collapsed. The
expanded set is read during render, never mutated there (same contract as the
FEAT-0024 collapsed set it replaces).

**Toggling.** Clicking a folder header flips its children's visibility in place,
as before. The new state is reported to the caller, which updates the persisted
**expanded** set: expanding adds the folder's path, collapsing removes it. The
set is persisted on every user toggle.

**Ancestor reveal is not persisted.** A folder force-shown only because it is an
ancestor of the active note is *not* added to the expanded set — it shows because
of the rule, not because the user expanded it. Once the active note moves
elsewhere, such a folder returns to collapsed (unless the user had expanded it).

**Persistence key.** The expanded set is stored under a new browser-local key,
distinct from the old collapsed-set key. The old key is abandoned (its meaning is
inverted, so its contents are not migrated); on first load after this change the
tree simply opens fully collapsed, which is the intended new default anyway.

**First paint matches saved state.** As in FEAT-0024, the expanded set is loaded
before the first folder open, so the tree's first paint reflects the saved
expansion rather than flashing one state then snapping to another.

## Constraints

- **No document mutation.** Expand/collapse is browser-local UI state; opening,
  expanding, or collapsing a folder writes nothing to the user's folder.
- The active note's ancestor folders are **always** rendered expanded, overriding
  the collapsed default and any absence from the expanded set.
- The render path is **pure** with respect to the expanded set — it reads it and
  never mutates it (mutation happens only in the toggle handler).
- The expanded set is the single source of truth for non-ancestor folders; a
  folder's rendered state is fully determined by (in expanded set) ∨ (ancestor of
  active).

## Out of scope

- **Migrating the old collapsed-set storage** to the inverted polarity — the old
  key is simply abandoned and the tree opens collapsed on first load.
- **A global expand-all / collapse-all control** — only per-folder toggling, as
  today.
- **Remembering expansion per note or per folder-open session** — a single
  vault-wide expanded set, as the collapsed set was.
- **Sidebar width / drag-to-resize** — that is FEAT-0044 (M13 Phase 2).

## Acceptance criteria

**AC-1** — A folder with no recorded state renders collapsed.
Given a note tree containing a folder whose path is not in the persisted expanded
set and which is not an ancestor of the active note,
When the note list renders,
Then that folder's children are hidden and only its header row is shown.

**AC-2** — A folder in the expanded set renders expanded.
Given a folder whose path is in the persisted expanded set,
When the note list renders,
Then that folder's children are visible.

**AC-3** — The active note's ancestor folders are always expanded.
Given an active note nested inside one or more folders, none of which are in the
expanded set,
When the note list renders,
Then every ancestor folder of the active note is expanded so the active note's
row is visible.

**AC-4** — Expanding a folder persists it.
Given a collapsed folder,
When the user clicks its header to expand it,
Then its path is added to the persisted expanded set and its children become
visible.

**AC-5** — Collapsing a folder persists the removal.
Given an expanded folder that the user previously expanded,
When the user clicks its header to collapse it,
Then its path is removed from the persisted expanded set and its children become
hidden.

**AC-6** — The expansion choice survives a reload.
Given the user expanded one folder and left the rest collapsed,
When the app reloads and the folder re-opens,
Then the tree's first paint shows that one folder expanded and the others
collapsed (matching the saved set), with no flash of a fully-expanded tree.

**AC-7** — Toggling a folder writes nothing to the user's folder.
Given an open folder with notes,
When the user expands or collapses any folder in the tree,
Then no file in the user's folder is created, modified, or deleted.
