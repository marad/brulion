# Workflow preflight checker — Phase 0 decisions

## Goal

Turn the preflight and durable phase-ledger requirements into a read-only,
versioned checker that can later be called by hooks and CI.

## Decisions

### 1. Node ESM entrypoint with a pure evaluator

Use the repository's existing Node ESM runtime. Separate observation collection
(git, specman, filesystem) from a pure evaluator that receives structured
observations and returns errors/success. This keeps fixture tests deterministic
and avoids making tests depend on a particular checkout.

**Concrete consequence:** `scripts/workflow-check.mjs` is the only CLI entrypoint;
its evaluator can be exercised without spawning git or editing files.

### 2. Explicit `preflight --milestone` invocation

The command requires an explicit milestone path rather than guessing from
ROADMAP or chat. Guessing would make compaction recovery ambiguous and could
validate the wrong ledger.

**Concrete consequence:** the package command is
`npm run workflow:check -- preflight --milestone milestones/M45.md`.

### 3. Ledger labels are stable and machine-checkable

The checker recognizes the three bold labels already used in `milestones/M45.md`:
`Current phase`, `Last completed gate`, and `Next action`. Missing labels are
reported individually. The checker never rewrites or normalizes the ledger.

**Concrete consequence:** a human-readable ledger remains the source of truth,
while its required fields are a stable interface for automation.

### 4. Fail closed, report all failures, never repair

The evaluator aggregates all missing/invalid checks and returns nonzero when any
exist. It does not stop at the first missing path and does not auto-create files,
clean a worktree, or infer spec state from partial output.

**Concrete consequence:** the parent workflow owns repair and recovery; a failed
check cannot silently advance a phase.

### 5. No command-level hard timeout in the checker

`specman status --verbose` and git are substantive repository observations, not
disposable probes. The checker does not impose a wall-clock kill boundary. A
launch or nonzero failure is reported as `specman-unavailable`; an operator can
manually stop a genuinely stuck invocation.

**Concrete consequence:** this checker follows the agreed worker-liveness policy
and does not turn slow but valid repository work into a false failure.

## Deferred decisions

- Which checker subcommands hooks and CI should call beyond `preflight`.
- Whether CI should require a clean worktree after each individual command or
  only before final evidence collection.
- The exact evidence artifact format for review and sealing.

## Self-Review

- **Load-bearing choice checked:** a pure evaluator plus command adapter is more
  code than one shell script, but it is the smallest shape that can test all
  failure states without mutating a fixture.
- **Ambiguity checked:** explicit milestone path and exact ledger labels avoid
  silent inference after compaction.
- **Scope checked:** no hooks, CI, test/build execution, or ledger repair is
  included in this phase.
- **Liveness checked:** no automatic kill or retry is introduced for specman or
  repository observation commands.
