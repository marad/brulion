---
id: FEAT-0090
title: Workbench freshness and release validation
status: draft
depends_on: [FEAT-0085, FEAT-0086, FEAT-0087, FEAT-0088, FEAT-0089]
---

## Intent

A separate workbench is useful only if it remains honest when the notes window,
another workbench, or an LLM agent edits the same vault. M41 closes with
filesystem-backed freshness, conflict diagnostics, and browser coverage for the
authoring workflow while preserving M40's portable polling baseline.

## Behavior

The workbench refreshes on attach, open, focus, and a bounded fallback cadence.
Refresh rereads manifests, supported files, enablement, and mtimes from the
filesystem before acting. A changed file becomes a conflict rather than an
implicit overwrite. Runner reloads are explicit and isolated; observer-backed
watching is not required.

## Acceptance criteria

- AC-1: Given the workbench attaches, opens, or regains focus, when it refreshes,
  then its tree and diagnostics reflect the current filesystem state.
- AC-2: Given another window or agent edits a file between read and save, when
  the workbench saves, then the mtime conflict is shown and disk bytes are
  preserved.
- AC-3: Given an extension is edited and explicitly reloaded, when reload fails,
  then the failure is diagnosed and the notes editor and other extensions remain
  usable.
- AC-4: Given no FileSystemObserver support, when the fallback cadence runs, then
  the workbench still converges by polling/rescanning without changing
  correctness semantics.
- AC-5: Given a real Chromium vault, when a user creates, edits, saves, enables,
  and runs a multi-file extension, then browser tests cover the flow, including
  a second-window/external-edit conflict scenario.

## Out of scope

- FileSystemObserver as the baseline watcher; it remains M40.
- Last-writer-wins saves, inter-window IPC, or background execution.
