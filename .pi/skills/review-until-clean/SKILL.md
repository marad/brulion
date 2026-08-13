---
name: review-until-clean
description: Repeat the project code-review protocol until no material findings remain, restructuring recurring root causes.
---

# Review Until Clean

## Contract

**Input:** `ReviewLoopRequest { ownedDiff, specRefs, baseSha, headSha, reviewLedger, max? }`.

`baseSha`, `headSha`, and `reviewLedger` are immutable handoff metadata for
all rounds; do not silently move the review to a different worktree or HEAD.

**Output:** `ReviewLoopResult { status, rounds, findingClasses, evidence }`,
with `status` equal to `clean` or `blocked`.

Each round records the code-review result and the finding class of every
material issue. A blocked or failed worker is not a clean result.

## Required protocol

1. Run exactly one canonical `/skill:code-review` against the same owned diff,
   exact `baseSha...headSha` range, and current writer ownership; collect its
   structured result and append the round to `reviewLedger`. Do not launch a
   duplicate reviewer for the same round or use an ad-hoc reviewer as a silent
   substitute.
2. If the result is `blocked`, stop and surface the owner/action; do not retry
   by committing partial work.
3. If findings remain, fix them in the writer worktree, add discriminating
   tests, and run only the relevant targeted verification before the next
   round. Reserve the full Vitest/build/E2E sequence for the final shipping
   gate.
4. Track finding classes across rounds. After two consecutive rounds with the
   same class, stop point-fixing and restructure the underlying cause before
   reviewing again.
5. Stop only on `clean` with commands/tests/evidence recorded in the durable
   ledger and no material residual finding. A worker `needs_attention` event is
   not a timeout or a clean result; a failed, stopped, disappeared, or
   insufficiently evidenced run is `blocked` until a current-HEAD canonical
   review completes.
6. Do not pass hard wall-clock, turn, or tool timeouts to substantive workers;
   use watchdog attention, checkpoints, and explicit handoffs instead. Hard
   bounds are allowed only for disposable probes safe to abort.
