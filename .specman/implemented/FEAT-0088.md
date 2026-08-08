---
id: FEAT-0088
title: Versioned extension authoring kit
status: draft
depends_on: [FEAT-0086, FEAT-0087]
---

## Intent

The extension API should be usable by a person or an LLM agent without
reverse-engineering runtime internals. M41 ships one versioned Authoring Kit
that is both usable from the repository and available from the workbench.

## Behavior

The kit contains a valid disabled template, brulion-extension.d.ts, runnable
examples, an API reference, AGENTS.md, an LLM skill, and a ready-to-use
authoring prompt. The workbench exposes the kit version and lets the user copy
individual files or download the complete kit. The workbench and repository
consume the same versioned source so these surfaces cannot silently diverge.

## Acceptance criteria

- AC-1: Given the repository, when the Authoring Kit is inspected, then it
  contains the template, declarations, examples, API reference, AGENTS.md, LLM
  skill, and authoring prompt.
- AC-2: Given the kit template, when it is copied into
  .brulion/scripts/<id>/, then it passes manifest validation and is safe-disabled
  until explicitly enabled.
- AC-3: Given the workbench is attached, when the user opens the Authoring Kit,
  then the kit version and deterministic file list are shown.
- AC-4: Given a kit file, when the user chooses Copy or Download, then its exact
  bytes are placed on the clipboard or in a downloaded kit file without
  rewriting its content.
- AC-5: Given the kit declares an API version, when an example is read, then it
  uses only the declared M39/M41 capabilities and does not require TypeScript,
  packages, network imports, timers, or background execution.
- AC-6: Given the workbench is attached, when the user chooses API docs, then a
  separate browser window opens a readable static API reference sourced from the
  same versioned API content as the Authoring Kit; the workbench remains open.

## Out of scope

- An in-app LLM, remote template fetching, npm installation, or automatic
  extension publication.
