---
name: review-until-clean
description: Repeat the project code-review protocol until no material findings remain, restructuring recurring root causes.
---

# Review Until Clean

## Contract

**Input:** `ReviewLoopRequest { ownedDiff, specRefs, max? }`.

**Output:** `ReviewLoopResult { status, rounds, findingClasses, evidence }`,
with `status` equal to `clean` or `blocked`.

Each round records the code-review result and the finding class of every
material issue. A blocked or failed worker is not a clean result.

## Required protocol

1. Run `/skill:code-review` against the same owned diff and collect its
   structured result. Do not use an ad-hoc reviewer as a silent substitute.
2. If the result is `blocked`, stop and surface the owner/action; do not retry
   by committing partial work.
3. If findings remain, fix them in the writer worktree, add discriminating
   tests, and run the relevant verification before the next round.
4. Track finding classes across rounds. After two consecutive rounds with the
   same class, stop point-fixing and restructure the underlying cause before
   reviewing again.
5. Stop only on `clean` with commands/tests/evidence recorded and no material
   residual finding. A worker `needs_attention` event is not a timeout or a
   clean result.
6. Do not pass hard wall-clock, turn, or tool timeouts to substantive workers;
   use watchdog attention, checkpoints, and explicit handoffs instead. Hard
   bounds are allowed only for disposable probes safe to abort.
