---
id: FEAT-0096
title: Preflight and durable phase-ledger checker
status: draft
depends_on: [FEAT-0095]
---

## Intent

The workflow mapping is now discoverable, but prose still cannot stop a run when
repository ownership, milestone state, or phase prerequisites are wrong. Add a
read-only checker that turns the preflight and durable-ledger requirements into
explicit, actionable failures before production mutation. The checker must be
small, deterministic, and safe to run from a hook or CI later.

## Behavior

The checker exposes a `preflight` command through the package scripts and accepts
an explicit milestone file. It verifies that `AGENTS.md` is tracked, the required
repository documents and project-local skill mapping exist, `specman status
--verbose` can run, the source worktree is clean, and the milestone contains a
machine-readable workflow ledger with current phase, last completed gate, and
exact next action. It is read-only: it reports every failure, exits nonzero, and
never edits the ledger or repository.

The ledger parser treats missing or malformed fields as distinct failures. The
checker exposes pure evaluation contracts so tests can discriminate missing
paths, dirty ownership, unavailable specman, and malformed ledger state without
mutating the real checkout. A successful preflight proves only that the next
phase may begin; it does not claim that implementation, review, verify, seal,
or deployment gates have passed.

## Acceptance criteria

- AC-1: Given a clean checkout with tracked `AGENTS.md`, the required documents,
  the project-local mapping, a runnable `specman status --verbose`, and a valid
  ledger, when `npm run workflow:check -- preflight --milestone milestones/M45.md`
  runs, then it exits zero and reports a successful preflight.
- AC-2: Given a preflight observation with one or more missing required paths,
  when it is evaluated, then every missing path is reported with a stable error
  code and the command exits nonzero without creating or editing files.
- AC-3: Given a worktree with uncommitted or untracked changes, when preflight
  evaluates ownership, then it reports `dirty-worktree` and blocks the phase
  transition instead of silently accepting the state.
- AC-4: Given a milestone ledger missing `Current phase`, `Last completed gate`,
  or `Next action`, when it is parsed, then the specific missing ledger field is
  reported and the phase remains blocked.
- AC-5: Given an unavailable or failing `specman status --verbose`, when
  preflight runs, then it reports `specman-unavailable` with the command output
  and exits nonzero without claiming spec state.
- AC-6: Given a valid preflight observation, when the checker completes, then it
  performs no writes and returns a structured success containing the milestone
  path, ledger fields, and observed checks.
- AC-7: Given the package scripts and checker source, when a fresh checkout runs
  the documented command, then the command resolves to the checker without a
  machine-local alias or global configuration.

## Out of scope

- Commit-message hooks, push hooks, or GitHub Actions; those are FEAT-0097.
- Running tests, build, E2E, review, verify, or seal from this checker.
- Editing or auto-repairing a malformed phase ledger.
- Any production application or user-owned markdown change.
