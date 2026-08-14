---
name: goal
description: Start or resume a Brulion milestone using the repository's gated workflow. Use for milestone implementation requests.
---

# Goal

## Contract

**Input:** `GoalRequest { milestone, resume?, repositoryState }`.

**Output:** `GoalTransition { preflight, phase-ledger, nextGate }`, or
`GoalBlocked { kind, missingPaths, owner }`.

**Blocking kinds:** `missing-mapping`, `dirty-ownership`, `missing-ledger`,
`unavailable-spec-command`, and `worker-blocked`.

**Recovery owner:** the current parent workflow repairs mapping/ledger ownership,
or explicitly stops/steers a blocked worker. No mutation is retried until
ownership is clear.

## Required protocol

1. Confirm the project-local `goal`, `code-review`, and
   `review-until-clean` skill paths with
   `node scripts/workflow-mapping-check.mjs`, then run the repository preflight.
   Use `npm run workflow:gate -- ci` for a full gate; it resolves the active
   milestone ledger instead of assuming a historical milestone path.
2. Read `ROADMAP.md`, `DECISIONS.md`, and the active milestone; record current
   phase, last completed gate, and exact next action in its durable ledger.
3. For each phase, require the phase spec before code and `specman sync` before
   production edits or tests. Invoke the appropriate excavation/chisel skill
   rather than hand-writing a new module.
4. Keep one mutation writer per worktree. Reviewers are read-only and run in
   the writer's current worktree (`worktree:false`) at xhigh effort. Before a
   review, run the exact-base `workflow:gate -- pre-review` handoff and record
   its base/HEAD in the milestone review ledger. Use one canonical reviewer
   run/session for the loop, resuming it for follow-up rounds rather than
   launching fresh contexts; use one fresh xhigh pass only for the required
   final-clean check. A worker's `needs_attention` event is not a failure and
   does not kill it.
5. Substantive workers and reviews run asynchronously without a hard wall-clock,
   hard turn, or hard tool timeout by default. Bound only disposable probes or
   commands safe to abort.
6. After compaction, restart, missing mapping, or worker failure, stop before
   the next edit, inspect status/handoff/ledger, and resume only from the exact
   recorded gate. Never replace a missing reviewer result with a fresh clean
   claim; record the run as blocked until the current-HEAD review completes.

## Failure rule

A missing skill path, unavailable command, dirty ownership boundary, or failed
worker blocks the transition. Do not claim a skipped gate ran and do not commit
partial changes from a stopped worker.
