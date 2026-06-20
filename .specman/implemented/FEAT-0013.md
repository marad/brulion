---
id: FEAT-0013
title: External-change detection layer
status: draft
depends_on: [FEAT-0010, FEAT-0011]
---

## Intent

Brulion is one *view* on a folder that many tools write to (an AI session, a
CLI, vinote, a native capture helper). Today it only sees the folder at the
moments it acts on it — on open, and after its own mutations — so a note added,
edited, or deleted by another tool while Brulion is open goes unnoticed until a
reload, and an external edit to the open note is only ever discovered at save
time by the stale-write guard. This phase builds the missing sense organ: a way
to keep noticing what changed on disk while the app is open. It is the
foundation the later M4 phases act on — it only **detects and classifies**
change; reflecting it in the UI (FEAT-0014) and resolving conflicts (FEAT-0015)
build on top. Without it the app shows stale content and the folder-as-API moat
is only half-honored.

## Behavior

**The poller.** A generic, reusable timer (`watch.ts`) runs an async `tick`
function on a fixed interval. It is deliberately simple but has one hard rule: it
**never overlaps runs**. If a tick is still in flight when the interval elapses,
that beat is skipped rather than starting a second concurrent tick — disk reads
must not stack up. It exposes `start` and `stop`; after `stop` no further ticks
fire, including one already scheduled. Starting an already-running poller is a
no-op.

**The disk check.** The note controller gains a `checkDisk()` operation that
compares the folder's current on-disk state against what the controller last
saw, and classifies the difference. It re-lists the folder's `*.md` files and
re-reads the active note's `lastModified`, then reports:

- whether the **set of notes** changed (a note was added or removed externally),
- whether the **active note's content** changed on disk (its `lastModified`
  differs from the last value the controller recorded),
- whether the **active note was deleted** on disk,

and for the active-note cases it distinguishes whether the buffer currently has
**local unsaved edits** (`dirty`) — the signal that later separates a silent
refresh (FEAT-0014) from a conflict (FEAT-0015).

`checkDisk()` runs on the controller's existing serialize queue, so it cannot
interleave with `open`/`switchTo`/`addNote`/`removeNote` or read half-applied
state mid-operation. This phase **only detects**: `checkDisk()` performs no
buffer reload, no write, and no destructive action — acting on what it finds is
FEAT-0014 and FEAT-0015.

## Constraints

- Detection is by polling `getFile().lastModified` and re-listing the folder —
  no `FileSystemObserver` or other experimental watch API (see `DECISIONS.md`).
- The poller never runs two ticks concurrently, and never ticks after `stop`.
- `checkDisk()` is non-destructive: it never writes, never reloads the buffer,
  never deletes — it returns/records classification only.
- `checkDisk()` runs through the controller's serialize queue, consistent with
  every other folder/active-note operation.
- A `checkDisk()` while no folder is open is a safe no-op.

## Out of scope

- Acting on detected changes — refreshing the list/buffer is FEAT-0014; conflict
  resolution UX is FEAT-0015. This phase is detection only.
- Starting/stopping the poller from the app lifecycle (on folder open/re-pick) —
  wiring is FEAT-0014.
- Watching subfolders or nested notes — notes are root-only (M3).
- Real OS file-watching / push notifications — polling only (see `DECISIONS.md`).

## Acceptance criteria

**AC-1** — The poller fires its tick on the interval.
Given a poller created over a `tick` function with interval `T`,
When it is started and time advances by multiples of `T`,
Then `tick` is invoked once per elapsed interval.

**AC-2** — The poller never overlaps runs.
Given a `tick` whose async work outlasts the interval,
When the interval elapses while a previous tick is still in flight,
Then no second tick starts until the in-flight one settles (the beat is skipped,
not queued).

**AC-3** — Stop ends all ticking.
Given a started poller,
When it is stopped,
Then no further `tick` runs occur, including any interval that had already
elapsed but not yet fired.

**AC-4** — `checkDisk()` detects an externally added or removed note.
Given an open folder whose `*.md` listing has changed on disk since the
controller last read it (a note added or removed by another tool),
When `checkDisk()` runs,
Then it reports that the note set changed and what the current listing is.

**AC-5** — `checkDisk()` detects an external edit to the active note.
Given the active note's on-disk `lastModified` differs from the value the
controller last recorded for it,
When `checkDisk()` runs,
Then it reports that the active note changed on disk, and whether the buffer has
local unsaved edits.

**AC-6** — `checkDisk()` detects the active note being deleted on disk.
Given the active note's file no longer exists in the folder,
When `checkDisk()` runs,
Then it reports the active note as deleted on disk, and whether the buffer has
local unsaved edits.

**AC-7** — `checkDisk()` is non-destructive and serialized.
Given any on-disk change,
When `checkDisk()` runs,
Then it writes nothing, does not reload the editor buffer, and runs on the
controller's serialize queue so it cannot interleave with open/switch/create/
delete; with no folder open it is a no-op.
