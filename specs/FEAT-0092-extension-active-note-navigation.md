---
id: FEAT-0092
title: Extension active-note navigation
status: draft
depends_on: [FEAT-0091, FEAT-0036, FEAT-0039, FEAT-0061]
---

## Intent

An explicitly enabled extension should be able to follow or generate a note
path using the same active view as a person, without receiving the editor or
filesystem handles. Navigation must be serialized with ordinary note actions and
must preserve the existing guarded-save and route/history behavior so an
extension cannot discard edits or open a stale snapshot.

## Behavior

`getActiveNote()` reports the canonical active note path, or `null` when the
host has no active note. `openNote()` revalidates the requested path against the
currently attached folder, recognizes a note created externally or by
`notes.create()` even when the sidebar snapshot is stale, and never creates a
missing file. It returns `opened`, `already-open`, `missing`, or `conflict` with
canonical paths. A missing target leaves the current view untouched. A pending
edit is flushed through the existing mtime guard before a real switch; if that
flush encounters an external change, navigation returns `conflict` naming the
active note and leaves the conflict state for the existing UI. Concurrent
navigation requests are serialized by the controller.

When an optional anchor is supplied, a successful open attempts the existing
heading-slug scroll. The result reports `not-requested`, `found`, or
`not-found`; anchor resolution is visual only and never changes note bytes. A
successful switch updates the editor, sidebar active row, persisted active note,
recency, and normal hash route/history. Re-opening the active note does not push
a duplicate route or alter recency.

## Acceptance criteria

- AC-1: Given an attached vault with an active note, when an extension with
  `navigation:read` calls `getActiveNote`, then it receives only the canonical
  folder-relative `.md` path; when no note is active, it receives `null`.
- AC-2: Given a target file exists on disk but is absent from the current note
  list snapshot, when `openNote(target)` is called with `navigation:write`, then
  it opens that file, refreshes the authoritative list/sidebar, and returns
  `status: "opened"` rather than `missing` or creating another file.
- AC-3: Given a target is absent on disk, when `openNote(target)` is called,
  then it returns `{status: "missing", path: target}` without creating the file,
  changing the active editor, changing the route, or changing recency.
- AC-4: Given the requested target is already active and exists on disk, when
  `openNote(target)` is called, then it returns `status: "already-open"`, does
  not flush or push a duplicate history entry, and still reports the requested
  anchor status if an anchor was supplied.
- AC-5: Given the active note has pending edits and a target file exists, when
  `openNote(target)` is called, then the current buffer is flushed through the
  normal mtime guard before switching; if the on-disk mtime conflicts, the
  result is `status: "conflict"` with the active path and neither note switch
  nor silent overwrite occurs.
- AC-6: Given two navigation requests arrive concurrently, when they target
  different existing notes, then the controller serializes them so the final
  editor, active row, saved active path, route, and mtime state all describe one
  completed operation rather than an interleaving.
- AC-7: Given a successful open with no anchor, with a matching heading slug, or
  with no matching heading, when the result is returned, then `anchorStatus` is
  respectively `not-requested`, `found`, or `not-found`; heading lookup skips
  fenced-code content and does not write the note.
- AC-8: Given an open or navigation operation is in progress and the vault is
  switched or detached, when an old callback completes, then it cannot mutate
  the newly attached vault or active editor and fails closed as an unavailable
  capability.

## Out of scope

- Creating, deleting, moving, or rewriting notes through navigation.
- `next`/`previous`, browser back/forward methods, automatic extension events,
  external URL opening, or custom extension UI.
