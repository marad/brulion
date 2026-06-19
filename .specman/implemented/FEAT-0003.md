---
id: FEAT-0003
title: Persist the folder handle
status: draft
depends_on: [FEAT-0002]
---

## Intent

Quick-capture dies if every visit starts with re-picking a folder. The File
System Access API lets a directory handle be stored and reused, but two things
stand in the way: the handle must survive a reload (it can't live in memory),
and the permission granted to it expires between sessions by default. This phase
makes a chosen folder *stick*: remember the handle across reloads, and restore
access with as little friction as the browser allows — zero clicks when the
user has granted a persistent permission, one click otherwise. It deliberately
still does not open or write a note's contents (FEAT-0004); it only re-attaches
to the folder and shows its `.md` files, exactly as FEAT-0002 did after a pick.

## Behavior

When the user picks a folder (the FEAT-0002 flow), its directory handle is
stored in IndexedDB via `idb-keyval` under a stable key. Handles are
structured-cloneable, which is why IndexedDB works and `localStorage` (strings
only) would not.

On load — with no user gesture available — the app reads the stored handle. If
none is stored, it starts in the plain "pick a folder" state from FEAT-0002. If
a handle is found, it calls `handle.queryPermission({ mode: "readwrite" })`
silently:

- If the result is `granted` (for example because the user ticked Chrome's
  "allow on every visit" persistent grant), access is live immediately: the
  app lists the folder's `.md` files with **zero clicks**.
- Otherwise (`prompt` or `denied`), re-granting needs a user gesture, so the
  app shows a single "Resume folder access" control. Clicking it calls
  `handle.requestPermission({ mode: "readwrite" })`; if that returns `granted`,
  the control disappears and the folder's files are listed. If the user
  declines, the control remains so they can try again.

`readwrite` is requested consistently (matching the FEAT-0002 pick) so the same
grant covers the writes coming in FEAT-0004.

## Constraints

- The handle is persisted in IndexedDB (via `idb-keyval`), not `localStorage`.
- `queryPermission` on load is silent (no gesture); `requestPermission` only
  ever runs from a user gesture (the "Resume folder access" click).
- Permission mode is `readwrite` everywhere, consistent with FEAT-0002.
- Still no reading or writing of file *contents* (FEAT-0004).

## Out of scope

- Opening, reading, editing, or saving a note's contents (FEAT-0004).
- Creating the default `start` note (FEAT-0004).
- Multiple folders / workspaces keyed by query param (backlog).
- Detecting external changes / conflicts (M4).

## Acceptance criteria

**AC-1** — Picking a folder persists its handle.
Given the user picks a folder via the FEAT-0002 flow,
When the pick succeeds,
Then the directory handle is written to IndexedDB under a stable key, so it is
available on a later load.

**AC-2** — A still-granted folder is restored with zero clicks on load.
Given a handle is persisted and `queryPermission({ mode: "readwrite" })` returns
`granted`,
When the app loads,
Then the folder's `.md` files are listed without any user interaction — no
re-pick and no "Resume folder access" click — and no resume control is shown.

**AC-3** — A folder needing re-grant is restored with one click.
Given a handle is persisted and `queryPermission({ mode: "readwrite" })` returns
`prompt` or `denied`,
When the app loads,
Then a "Resume folder access" control is shown; and when the user clicks it and
`requestPermission({ mode: "readwrite" })` returns `granted`, the control is
hidden and the folder's `.md` files are listed.

**AC-4** — With nothing persisted, the app starts in the pick-a-folder state.
Given no handle is stored in IndexedDB,
When the app loads,
Then no "Resume folder access" control is shown and no folder is listed; the
user can pick a folder exactly as in FEAT-0002.
