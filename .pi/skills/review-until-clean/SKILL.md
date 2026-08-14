---
name: review-until-clean
description: Repeat the project code-review protocol until no material findings remain, restructuring recurring root causes.
---

# Review Until Clean

## Contract

**Input:** `ReviewLoopRequest { ownedDiff, reviewPacket, specRefs, baseSha, headSha, reviewLedger, max? }`.

`baseSha` and the `reviewLedger` destination are immutable handoff metadata for
the loop; the ledger contents are append-only round evidence. `headSha`
identifies the exact current HEAD for the round and must be refreshed after an
accepted fix; never review a stale HEAD or silently move the review to a
different worktree. `reviewPacket` is the compact phase context: changed
paths, ACs and non-negotiable invariants, explicit non-goals, and the edge-case
test matrix.

**Output:** `ReviewLoopResult { status, rounds, findingClasses, evidence }`,
with `status` equal to `clean` or `blocked`.

Each round records the code-review result and the finding class of every
material issue. A blocked or failed worker is not a clean result.

## Required protocol

1. Run exactly one canonical `/skill:code-review` against the owned diff,
   exact `baseSha...headSha` range, current writer ownership, and the compact
   `reviewPacket`; collect its structured result and append the round to
   `reviewLedger`. The first pass must be exhaustive: report every material
   finding established by the diff and contract, not merely the first finding.
   Do not launch a duplicate reviewer for the same round or use an ad-hoc
   reviewer as a silent substitute. The reviewer runs focused checks only and
   must not run the full Vitest/build/E2E shipping sequence for each round.
2. If the result is `blocked`, stop and surface the owner/action; do not retry
   by committing partial work.
3. If findings remain, the writer fixes all accepted material findings from
   that round in one batch, adds discriminating tests, and runs only the
   relevant targeted verification before the next round. Every finding gets a
   recorded disposition; unresolved material findings block `clean`. Update
   `headSha` and the ledger after the batch; reserve the full Vitest/build/E2E
   sequence for the final shipping gate.
4. Follow-up rounds inspect the changed files and prior finding classes narrowly.
   A retained read-only reviewer may be resumed for a targeted follow-up to
   avoid reloading the entire context. The final clean round must always use a
   fresh-context canonical reviewer to guard against anchoring.
5. Track finding classes across rounds. After two consecutive rounds with the
   same class, stop point-fixing and restructure the underlying cause before
   reviewing again.
6. Stop only on `clean` with commands/tests/evidence recorded in the durable
   ledger and no material residual finding. A worker `needs_attention` event is
   not a timeout or a clean result; a failed, stopped, disappeared, or
   insufficiently evidenced run is `blocked` until a current-HEAD canonical
   review completes.
7. Do not pass hard wall-clock, turn, or tool timeouts to substantive workers;
   use watchdog attention, checkpoints, and explicit handoffs instead. Hard
   bounds are allowed only for disposable probes safe to abort.
