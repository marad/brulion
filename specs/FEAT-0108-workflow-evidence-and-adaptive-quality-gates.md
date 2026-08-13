---
id: FEAT-0108
title: "Workflow evidence and adaptive quality gates"
status: draft
depends_on: []
---

## Intent

The repository already has fail-closed workflow gates, but the review handoff and
quality entry point still depend on stale milestone defaults and chat-only
context. Make the workflow faster without weakening its evidence requirements:
select the actual active milestone, catch recursive verification and derived
artifact drift before an adversarial review, and leave a durable record of the
reviewed commit range and findings.

## Behavior

The quality and pre-push gates resolve the milestone from the repository's
phase ledgers instead of naming a historical milestone in CI configuration. A
single milestone whose ledger is not closed is the active target; multiple open
milestones block the gate. When every tracked milestone is closed, the gate
uses the latest numbered milestone as the final-shipping target. An explicit
`--milestone` remains available for bounded local checks.

A read-only pre-review gate accepts an exact base commit and spec id, reports the
base and current HEAD plus the owned changed paths, and checks diff whitespace,
spec validity/status, verification-plan self-recursion, and checked-in derived
Authoring Kit artifacts. It never edits the worktree or runs the full browser
suite. The full gate runs the same checks before the existing workflow tests,
Vitest, build, and Chromium suite.

The review protocol records the base SHA, reviewed HEAD, round number, final
status, findings and evidence in the active milestone's review ledger. A failed
or blocked worker is never clean; targeted tests are used while fixing a round,
and the full final suite remains the shipping gate. The protocol continues to
forbid hard timeouts for substantive workers.

## Acceptance criteria

- AC-1: Given a checkout with one open milestone ledger, when CI or pre-push
  runs without `--milestone`, then it selects that milestone; when all ledgers
  are closed it selects the latest numbered milestone; when more than one is
  open it fails closed and names each candidate; an explicit path still wins.
- AC-2: Given a `.specman/plans/FEAT-NNNN.md` verification section, when it
  contains `specman verify FEAT-NNNN` as a verification command, then the plan
  check fails with the plan and spec id; prose mentions outside the verification
  command list remain allowed.
- AC-3: Given the checked-in Authoring Kit and its derived `public/` files,
  when the artifact check runs, then byte drift is reported and blocks the
  gate; matching files pass without modifying either source or generated file.
- AC-4: Given an exact base commit and spec id, when the read-only pre-review
  gate runs, then it reports base, HEAD, changed paths, spec status, plan and
  artifact checks, rejects an unknown base or whitespace error, and never
  writes repository state or runs the full E2E suite.
- AC-5: Given the project workflow instructions, when a review round is
  recorded, then the durable ledger requires base SHA, reviewed HEAD, round,
  status, findings, and command/test evidence; blocked or failed review runs
  cannot be recorded as clean, and the canonical review instructions require
  one current-HEAD reviewer with no hard substantive-worker timeout.
- AC-6: Given the full quality gate, when it runs in CI or pre-push, then it
  uses the resolved milestone and performs plan/artifact checks before the
  existing workflow tests, Vitest, build, and Chromium validation; no
  application capability, file format, or existing gate is weakened.

## Out of scope

- changing application behavior or user-owned Markdown bytes;
- parallel mutation workers, automatic worker killing/retry, or hard timeouts;
- replacing the adversarial review loop with a script or accepting insufficient
  evidence as clean;
- making CI infer a milestone from external GitHub settings;
- regenerating checked-in artifacts during a read-only check.

