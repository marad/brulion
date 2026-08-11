---
id: FEAT-0094
title: Extension navigation browser coverage and examples
status: draft
depends_on: [FEAT-0091, FEAT-0092, FEAT-0093]
---

## Intent

The navigation API crosses the sandbox, File System Access, editor, and route
boundaries. Unit tests alone cannot prove that those boundaries compose in the
browser, so finish M43 with real Chromium/OPFS coverage and small Authoring Kit
examples that demonstrate safe navigation without hiding its explicit failure
and creation decisions.

## Behavior

The browser suite runs an explicitly enabled extension against an OPFS-backed
vault and verifies the public navigation calls through the real sandbox/RPC
path. It covers active-note reads, existing and missing opens, anchors, guarded
conflicts, vault isolation, markdown and wikilink resolution, and the explicit
`notes.create()`-then-`navigation.openNote()` flow. The suite does not fake a
successful result by calling host callbacks directly.

The Authoring Kit includes concise examples for opening a journal note and for
resolving then deliberately opening a link. Examples request only the
permissions they use, handle discriminated missing/conflict results, and never
use DOM, URL, handles, or implicit creation. Contract drift tests keep the
examples, declarations, JSON contract, and runtime inventory aligned.

## Acceptance criteria

- AC-1: Given a real Chromium page with an OPFS vault and an explicitly enabled
  extension, when it calls `getActiveNote`, then the result travels through the
  opaque iframe/RPC boundary and identifies the actual active note.
- AC-2: Given existing and missing OPFS notes, when the extension opens them,
  then existing notes switch in the live editor and missing notes return
  `missing` without a newly created file.
- AC-3: Given a heading anchor and a note with matching and non-matching
  headings, when the extension opens the note, then the browser observes the
  found/not-found anchor result and no markdown bytes change.
- AC-4: Given a dirty active editor and an external mtime change, when the
  extension requests another note, then the browser observes `conflict`, the
  external bytes remain intact, and the active note does not silently switch.
- AC-5: Given markdown and wikilink destinations covering relative paths,
  basename/path matches, anchors, missing targets, external URLs, and invalid
  inputs, when the extension resolves them in Chromium, then results match the
  unit contract and resolution causes no navigation or write.
- AC-6: Given an extension-created note, when the extension awaits
  `notes.create()` and then calls `navigation.openNote()` without a sidebar
  refresh, then the new note opens successfully and the active route/sidebar
  converge on it.
- AC-7: Given two vaults or a stale runner from a previous vault, when the old
  runner calls navigation after the switch, then the capability fails closed and
  cannot change the new vault.
- AC-8: Given the Authoring Kit examples, when they are inspected and exercised,
  then they declare least-privilege navigation permissions, use the documented
  result unions, and contain no direct DOM, URL, FSA, network, or implicit
  create-if-missing access.

## Out of scope

- Native OS folder-picker and permission-prompt automation; those remain a live
  review check.
- Additional navigation capabilities, automatic triggers, custom UI, or a
  second browser-history abstraction.
