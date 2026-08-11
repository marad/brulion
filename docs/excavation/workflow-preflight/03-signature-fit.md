# Workflow preflight checker — Phase 3 signature-fit review

## Cold-context review report

The reviewer read only the committed spec, plan, architecture, milestone ledger,
and signatures.

- **Blocker:** all five exported functions in `scripts/workflow-check.mjs` are
  stubs, so valid and invalid preflight scenarios cannot produce results.
- **Blocker:** malformed or missing ledger fields have no `ledger-missing-*`
  payload contract; the stub throws a generic error.
- **Blocker:** failing `specman` cannot be observed, so
  `specman-unavailable` cannot preserve output, launch failure, or exit status.
- **High:** the architecture promises typed `PreflightObservation`,
  `PreflightResult`, and exit status, but the implementation only partially
  types the result; observation, checks, `run`, and `formatPreflightResult` have
  no executable boundary contract.
- **Note:** no hidden writes are present only because the collector is absent;
  read-only behavior and retry/error ownership remain unexercised.

## Main-agent response

The findings are accepted as a signature-stage failure, not implementation
findings to patch around. The signature artifact will be regenerated with
explicit JSDoc payload types for observations, checks, ledger errors, command
results, result formatting, and CLI exit behavior. Bodies remain stubs until
tests are written in the next phase.

## Self-Review

- The recurring class is **untyped boundary state**, so adding one more generic
  `object` annotation would be a point fix; the signatures will be regenerated
  around named payload shapes instead.
- The collector must preserve command status/output without assigning retry or
  repair ownership to itself.
- The parser must return field-specific errors rather than throw for user-owned
  ledger text; the CLI may throw only for invalid command syntax.
- No tests or bodies are accepted yet; the next gate is contract-driven tests.

## Regeneration result

The signatures were regenerated around named `LedgerParseResult`,
`PreflightObservation`, `PreflightResult`, `PreflightReport`, and
`MilestonePathResult` payloads. The implementation now preserves command output,
rejects root escapes, reports unreadable milestones, and validates CLI operands;
those behaviors are covered by discriminating Node tests.

## Round 3 review response

The review found that a milestone read failure could still trigger misleading
ledger errors, and the existing symlink test did not cover a dangling link. The
contract now carries `ledgerReadable`, skips parsing when the file cannot be
read, and the test suite rejects both existing and dangling symlink paths.

## Round 2 review response

An independent review found three boundary gaps: missing CLI operands could
throw, absolute/symlinked paths could escape the root, and permission/read
failures could be misclassified or thrown. The implementation contract was
extended with `MilestonePathResult`, `collectionErrors`, explicit operand
validation, conservative symlink rejection, and structured unreadable-path
errors. Tests now cover a dangling/external symlink, an unreadable directory and
file when the platform permits the probe, and the missing operand.

## Round 4 review response

The review identified two operational edges: a clean-CLI assertion was coupled
to reviewer-generated `.pi-subagents` artifacts, and a failed `git status` could
look clean. The no-write test now accepts the expected blocked exit while still
asserting no mutation; the collector carries `worktreeCommandOk` and emits
`git-unavailable`, so Git observation failures fail closed.

## Round 5 review response

The evaluator now independently derives `git-unavailable` when the observation
says Git status failed, even if a caller omitted the collection error. The valid
pure result also exercises the successful report/exit contract, while the real
collector/CLI test remains focused on read-only behavior and accepts the
expected blocked status when the checkout is dirty.
