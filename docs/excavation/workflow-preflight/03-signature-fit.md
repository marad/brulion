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
