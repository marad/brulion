# Workflow gate enforcement — Phase 0 decisions

## Goal

Make commit, push, and CI checks use one checked-in gate implementation without
turning local hooks into an unavoidable machine-local requirement.

## Decisions

### 1. One Node gate entrypoint, multiple modes

Use `scripts/workflow-gate.mjs` as the single implementation. `pre-commit`,
`commit-message`, `pre-push`, and `ci` are explicit modes; hooks and CI are thin
shims. The command executor accepts an injected runner for deterministic tests.

**Consequence:** local and CI behavior cannot drift by duplicating shell logic,
and the full command order is testable without running E2E in every unit case.

### 2. Spec trailers are required only for behavioral/workflow changes

The commit-message gate classifies staged paths. Implementation and workflow
paths require at least one `Spec: FEAT-NNNN/AC-M` trailer; spec-only and
explanatory documentation commits do not. This preserves the traceability gate
without forcing fabricated references into purely editorial commits.

**Consequence:** a mixed commit containing code still requires a trailer, while
`DECISIONS.md`, `ROADMAP.md`, and standalone spec edits remain lightweight.

### 3. Hooks are opt-in; CI is authoritative

The installer sets repository-local `core.hooksPath` only when explicitly run.
The checked-in quality workflow runs the same `ci` mode on pull requests and
main, and the Pages deployment workflow gates its build/deploy job on quality.

**Consequence:** bypassing or not installing hooks cannot bypass deploy checks;
clones remain usable without hidden global Git configuration.

### 4. Full gate order is fixed and fail-fast

The full sequence is: preflight, `specman validate`, workflow tests, Vitest,
build, and E2E. A nonzero command returns command/output evidence and later
commands do not run. There are no automatic retries or hard timeouts.

**Consequence:** a slow or failed command remains visible to the operator, and
CI cannot report a false pass from a partial sequence.

### 5. Hook installation is reversible and repository-local

The installer records only `core.hooksPath=.githooks` in the local repository
configuration. It does not edit user-level config or source files. Removing the
config restores Git's default hook lookup.

**Consequence:** adoption is explicit and does not create machine-wide side
effects.

## Deferred decisions

- Whether future hooks should enforce branch naming or signed commits.
- Whether CI should publish structured evidence as an artifact in addition to
  command logs.
- Whether pre-push should offer a documented fast mode; the initial policy uses
  the full gate.

## Self-Review

- **Complexity checked:** one entrypoint plus thin shims is smaller than separate
  hook/CI implementations and is the minimum shape that prevents drift.
- **Traceability checked:** path classification avoids both missing trailers on
  code and unnecessary trailers on editorial decisions.
- **Authority checked:** local hooks are convenience only; deploy has an
  in-workflow quality prerequisite.
- **Liveness checked:** no command or worker receives an automatic hard timeout
  or retry.
