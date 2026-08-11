---
name: code-review
description: Perform one adversarial review pass over the owned Brulion diff and report or fix material findings.
---

# Code Review

## Contract

**Input:** `ReviewRequest { diff, specRefs, writer, round }`.

**Output:** `ReviewResult { status, findings, evidence, changedFiles }`, with
`status` equal to `clean`, `findings`, or `blocked`.

Each finding has `{ id, class, severity, location, evidence, disposition }`.
Evidence must identify a command, test, diff fact, or residual risk. A test
added for a fix must be discriminating: it must fail against the pre-fix
behavior.

**Blocking kinds:** `missing-mapping`, `shared-writer`, `worker-blocked`, and
`insufficient-evidence`. A failed or stopped worker is never a successful review
result.

## Required protocol

1. Confirm the current diff and its ownership before reading for findings; do
   not review another writer's active worktree.
2. Read the relevant spec/ACs and inspect the changed code, tests, and boundary
   behavior. Report only material findings, with file and line locations.
3. For each fix, add or strengthen a discriminating test when behavior can be
   tested. Never weaken a test to match an implementation.
4. If the review worker stops or becomes blocked, return `blocked`; never return
   `clean` and never merge its partial changes.
5. Do not pass `timeoutMs`/`maxRuntimeMs`, hard turn budgets, or hard tool
   budgets to substantive mutation workers. Watchdog attention is not a kill
   signal; manual steer/stop owns recovery.
6. Return a concise report with findings, evidence, changed files, and residual
   risks so the loop can classify the round.
