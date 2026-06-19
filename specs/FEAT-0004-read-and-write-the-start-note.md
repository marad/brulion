---
id: FEAT-0004
title: Read and write the start note
status: draft
depends_on: [FEAT-0003]
---

## Intent

This is where the pipeline becomes real: the user's keystrokes have to land in a
plain markdown file on their disk and still be there after they close
everything. Until now the app could see a folder; now it reads and writes one
note in it — `start.md` — with the friction of a quick-capture tool, which is to
say none. Typing should persist on its own; the user should never think about
saving. But the product's whole reason to exist is that the file is theirs and
trustworthy, so persistence must never come at the cost of silently destroying a
change made to that file by something else (an editor, a sync client, an AI
writing to the folder). This phase delivers autosave with that guard, and closes
M1's headline promise: notes survive a restart.

## Behavior

Once the app has access to a folder (freshly picked or restored), it binds the
editor to `start.md`. If the file exists, its text is loaded into the editor and
the app remembers the file's `lastModified` timestamp. If it does not exist, the
editor opens an empty buffer and **nothing is written yet** — `start.md` is
created on the first save, not merely by opening the folder (see `DECISIONS.md`).

Saving is automatic and low-friction. While the editor has unsaved changes, a
save is scheduled ~600 ms after the last keystroke (debounced), so a burst of
typing produces one write when the user pauses. In addition, pending changes are
flushed immediately when the window/tab loses focus (`blur` /
`visibilitychange` to hidden) and when the user presses `Ctrl/Cmd+S`. All routes
funnel through one save operation; a save with no pending changes is a no-op.

A save writes via `getFileHandle("start.md", { create: true })` +
`createWritable()`, then records the new `lastModified`. But before overwriting
an existing file, the save compares the file's current on-disk `lastModified`
with the timestamp the app last recorded. If they differ, something else changed
`start.md` since the app last read or wrote it: the save **does not overwrite**.
Instead it surfaces a conflict indication and leaves both the on-disk file and
the editor buffer intact, so no data is lost. (Full conflict *resolution* — merge
/ reload / choose — is M4; M1 only guarantees no silent clobber.)

## Constraints

- The note file is `start.md`; created lazily on first save, never on open.
- Autosave debounce is ~600 ms; `blur`/`visibilitychange` and `Ctrl/Cmd+S` flush
  immediately; a no-change save is a no-op.
- A save must re-check `lastModified` and refuse to overwrite an externally
  changed file (no silent clobber).
- Only `start.md` is read/written — no other notes, no new-note UI (that is M3).
- No periodic watching/polling for external changes while idle (that is M4); the
  guard is checked only at save time.

## Out of scope

- Conflict *resolution* UX (merge/reload/keep-both) — M4.
- Watching the folder for external changes while the app sits idle — M4.
- Multiple notes, listing-to-open, creating/renaming/deleting notes — M3.
- Syntax hiding / WYSIWYG rendering — M2.

## Acceptance criteria

**AC-1** — An existing `start.md` is loaded into the editor.
Given a folder whose `start.md` contains text,
When the app gains access to that folder (pick or restore),
Then the editor displays that text.

**AC-2** — `start.md` is created on first save, not on open.
Given a folder that has no `start.md`,
When the app gains access to the folder,
Then no `start.md` is written; and when the user then edits and a save fires,
Then `start.md` is created containing the editor's text.

**AC-3** — Edits autosave to disk after a pause.
Given the editor is bound to `start.md` and the user types,
When roughly 600 ms pass with no further keystroke,
Then the editor's content is written to `start.md` without any explicit save
action.

**AC-4** — Pending edits flush on focus loss and on Ctrl/Cmd+S.
Given the editor has unsaved changes,
When the window/tab loses focus (`blur` or `visibilitychange` to hidden) or the
user presses `Ctrl/Cmd+S`,
Then the content is written to `start.md` immediately rather than waiting for the
debounce.

**AC-5** — A save never silently overwrites an externally changed file.
Given `start.md` has been modified on disk (its `lastModified` differs from what
the app last recorded) since the app last read or wrote it,
When a save would write,
Then the app does not overwrite the file; it surfaces a conflict indication and
leaves the on-disk file and the editor buffer unchanged.

**AC-6** — Saved content survives a restart.
Given the user has edited `start.md` and the content has been saved,
When the app is closed and reopened against the same folder (handle restored per
FEAT-0003),
Then the editor shows the saved content.
