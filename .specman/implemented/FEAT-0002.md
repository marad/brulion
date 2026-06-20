---
id: FEAT-0002
title: Folder access
status: draft
depends_on: [FEAT-0001]
---

## Intent

Brulion's whole premise is that the user's notes are plain files in a folder
they own. The first step toward that is letting the user point the app at a
folder on their disk and grant it access. The File System Access API gates this
behind a user gesture in a secure context, so it must start from an explicit
click — never on load. This phase establishes that gateway: a click opens the
picker and the app obtains a readwrite directory handle it can later read and
write through. It deliberately stops there — no persistence across reloads
(FEAT-0003), and no reading or writing of a note's contents (FEAT-0004).

A visible, clickable note list/switcher is **not** part of this phase — that
belongs with M3 (multiple notes), where opening a chosen note is meaningful. In
M1 there is a single note (`start`), so a static list of every `.md` in the
folder would be non-functional clutter. The folder-access gateway here only has
to hand a usable handle to the rest of the pipeline.

## Behavior

A visible "Open folder" control sits in the app shell. Clicking it — the
required user gesture — calls `showDirectoryPicker({ mode: "readwrite" })`. We
request `readwrite` now (not `read`) even though nothing is written yet, so the
same grant carries into later phases that write, avoiding a second permission
prompt.

On success the app holds a directory handle and hands it to the rest of the
pipeline (in M1, opening `start.md` — FEAT-0004). If the user dismisses the
picker, the browser rejects with an `AbortError`; this is treated as a no-op —
no error surfaced, the app left exactly as it was.

## Constraints

- Folder access must originate from a user gesture (a click), never `onload`.
- `showDirectoryPicker` is called with `{ mode: "readwrite" }`.
- No persistence of the handle this phase (FEAT-0003) and no file contents read
  or written (FEAT-0004).
- No visible note list / switcher in M1 (that is M3).

## Out of scope

- A visible, clickable note list / switcher — M3 (multiple notes).
- Persisting the directory handle / restoring it across reloads (FEAT-0003).
- Opening, reading, editing, or saving any note's contents (FEAT-0004).
- Detecting files changed by other tools / conflict handling (M4).

## Acceptance criteria

**AC-1** — An explicit control opens the directory picker.
Given the app is loaded,
When the user clicks the "Open folder" control,
Then `showDirectoryPicker` is invoked with `{ mode: "readwrite" }` (the call
originates from the click gesture, not from page load).

**AC-4** — Dismissing the picker is a no-op.
Given the user opens and then cancels/dismisses the directory picker,
When the picker rejects with `AbortError`,
Then no error is surfaced and the app state is unchanged from before the click.
