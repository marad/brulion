# Workflow command mapping — Phase 0 decisions

## Goal

Make the repository's workflow instructions executable in a fresh trusted pi
checkout without relying on commands that this runtime does not provide.

## Decisions

### 1. Project-local skills are the source of truth

The mapping lives in versioned project-local Agent Skills, not in a user's home
configuration and not in an untracked terminal alias. This makes the workflow
reviewable, portable, and recoverable after compaction or a new session.

**Concrete consequence:** the workflow exposes `goal`, `code-review`, and
`review-until-clean` through pi's real `/skill:<name>` command form.

### 2. Historical bare names are labels, not commands

The prose names `/goal` and `/code-review` came from another harness and are not
invocable in this pi runtime. `AGENTS.md` will map them explicitly to
`/skill:goal` and `/skill:code-review` rather than claiming the bare forms ran.
Specman remains a CLI (`specman new`, `sync`, `verify`, `seal`, `validate`, and
`status`) in this project.

**Concrete consequence:** a missing project skill is a fail-closed preflight
failure, not a reason to substitute an improvised reviewer or runner.

### 3. Skills describe protocol; later tooling enforces mechanical checks

This phase only establishes the command mapping and the model-facing protocol.
The executable workflow checker, Git hooks, and CI gates are separate phases so
that the skill text does not become a pretend enforcement layer.

**Concrete consequence:** this phase must not modify production code or user
markdown, and it must identify those later gates as pending rather than imply
that skills alone enforce them.

### 4. No hard timeout for substantive workers

Goal and review instructions repeat the agreed policy: substantive workers and
reviews run asynchronously without a hard wall-clock, turn, or tool timeout by
default. Watchdog attention and explicit handoffs identify inactivity; manual
stop/steer is the recovery decision. Only disposable probes or safe-to-abort
commands may have an explicit bound.

**Concrete consequence:** a stopped or failed worker never supplies an implicit
review pass or authorizes merging partial changes.

## Deferred decisions

- The shape and CLI of the workflow checker are deferred to the runner phase.
- Hook installation and whether the local pre-push hook runs the complete E2E
  suite are deferred to the hooks/CI phase.
- The exact CI job split is deferred to the CI phase.
- The repository's review artifact format is deferred to the review-runner
  phase; this phase only defines the protocol.

## Self-Review

- **Load-bearing choice checked:** project-local skills versus global pi skills.
  A global install would be easier to invoke today but would make a fresh
  checkout depend on machine state, so the project-local choice is retained.
- **Command semantics checked:** the plan distinguishes `/skill:<name>` from
  historical bare labels and keeps specman commands as CLI commands.
- **Scope checked:** no runner or hook behavior is promised here; those are
  separate acceptance criteria and phases.
- **Simplification checked:** three skills are the smallest mapping that keeps
  kickoff, one review pass, and the review loop independently discoverable.
