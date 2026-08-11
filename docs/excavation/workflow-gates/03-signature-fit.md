# Workflow gate enforcement — Phase 3 signature-fit review

## Cold-context review report

The reviewer read the committed spec, plan, architecture, milestone ledger, hook
stubs, installer stub, and gate signatures.

- **Blocker:** the gate entrypoint is stubbed, so whitespace checks, trailer
  validation, command ordering, failure evidence, and CLI exits cannot execute.
- **Blocker:** the installer and hook shims are no-ops; they do not set local
  `core.hooksPath` or delegate Git payloads.
- **High:** `runFastGate` does not accept the cached diff/mapping inputs promised
  by the architecture and declares the wrong result type; `buildFullGatePlan`
  omits the documented mode field.
- **High:** AC-7 has no executable CI/deploy workflow payload yet; the plan only
  names future files.
- **High:** M45's ledger claims P1 as the last completed gate while P1 remains
  unchecked and FEAT-0097 is still draft/new. The ledger needs correction before
  P2 can close, not silent inference.
- **Residual:** `plan.md` and `progress.md` are not part of this repository's
  workflow artifacts; the durable ledger is `milestones/M45.md`.

## Main-agent response

The findings are accepted as the signature-stage gate. The entrypoint signatures
will be regenerated to distinguish fast-gate input/result from full-gate plan
input, and hook/CI payloads will be made explicit before tests are written. The
M45 P1 checkbox and ledger will be corrected as a separate documentation change;
FEAT-0097 remains draft until its implementation, review, verify, and seal gates
are complete.

## Self-Review

- The repeated class is **contract-to-adapter mismatch**: placeholder functions
  hid the fact that fast checks, full command execution, hooks, and CI have
  different inputs and authorities. They will not be collapsed into one generic
  result.
- CI/deploy is a real implementation boundary, not a documentation promise; it
  needs a testable checked-in workflow file and a deploy dependency.
- The durable ledger is the authoritative state; its checkbox and text must move
  together at the phase boundary.
