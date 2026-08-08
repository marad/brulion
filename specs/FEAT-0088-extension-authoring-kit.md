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
The API reference is a task-oriented reference rather than a short README: it
covers the manifest, permissions, runtime lifecycle, security limits, every
supported namespace and method, error/concurrency semantics, and copyable
recipes. A machine-readable versioned API contract is the canonical source for
method signatures, parameters, return unions, permissions, limits, and examples;
the browser reference and TypeScript declarations are derived from it, while
human-oriented guides remain readable prose.

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
- AC-7: Given the API reference window, when TypeScript declarations or JavaScript
  code blocks are rendered, then syntax tokens receive the workbench's shared
  light/dark code colors while their exact source text remains selectable.
- AC-8: Given API version 1, when the canonical API contract is inspected, then
  it defines the manifest contract, permission-to-capability mapping, runtime
  constraints, and every supported public method with its parameters, return
  values, limits, and version metadata.
- AC-9: Given the API reference window, when a developer follows the reference,
  then it provides an executable-looking quickstart and a complete reference
  for commands, editor, and notes, including note creation, guarded writes,
  deletion, and moves; each method identifies its required permission, input
  constraints, return union, rejection conditions, side effects, and a focused
  JavaScript example.
- AC-10: Given a long API reference, when a developer navigates it, then a
  table of contents, stable section anchors, symbol search, and copy controls
  make the quickstart, method reference, and recipes reachable without relying
  on browser find or scrolling through declaration source.
- AC-11: Given the canonical API contract, when the authoring kit is built, then
  the browser reference and TypeScript declarations expose the same method
  inventory and signatures, and a contract test fails if a documented public
  method is missing from either generated artifact or the runtime bridge.
- AC-12: Given an API method that reads or writes user-owned notes, when its
  reference is read, then it explicitly describes folder-relative markdown
  paths, normalization, external-edit conflict behavior, and whether the
  operation preserves or changes file bytes; the examples demonstrate the
  file-fidelity-safe calling pattern.

## Out of scope

- An in-app LLM, remote template fetching, npm installation, or automatic
  extension publication.
