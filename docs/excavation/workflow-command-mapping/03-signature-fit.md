# Workflow command mapping — Phase 3 signature-fit review

## Cold-context review report

The reviewer read only `01-architecture.md` and the three signature stubs.

- **Kickoff (High):** the goal stub cannot express preflight, ledger transition,
  phase ordering, or recovery (`.pi/skills/goal/SKILL.md:8-18`).
- **Missing mapping (High):** unknown-command handling has no repair authority or
  distinct missing-file error (`01-architecture.md:70-74,81-84`).
- **One review pass (High):** the review stub cannot express inspection,
  discriminating tests, fixes, or resolution (`01-architecture.md:70-75`,
  `.pi/skills/code-review/SKILL.md:8-18`).
- **Repeated finding (High):** the loop has no finding-class, round counter,
  restructuring owner, or action payload (`01-architecture.md:75`,
  `.pi/skills/review-until-clean/SKILL.md:8-18`).
- **Stopped worker (High):** liveness belongs to the parent, but retry/restart
  and blocked-state payloads remain unspecified (`01-architecture.md:76-79,91-100`).
- **Residual:** the architecture references future `plan.md` and `progress.md`
  artifacts that do not exist yet; all three skill protocols are pass-through
  stubs.

## Main-agent response

The findings are accepted. The stubs will be regenerated with explicit
preconditions, state payloads, failure owners, and retry/recovery contracts
before tests are written. The architecture will also name the parent workflow
as the repair/recovery owner and distinguish a missing mapping from an ordinary
review finding.

## Self-Review

- The review was cold-context and adversarial; it found the expected gap between
  labels and executable contracts rather than confirming the initial stubs.
- The repeated high-severity class is **under-specified state transitions**, so
  patching individual sentences would preserve the problem. The stubs and the
  affected architecture rows will be regenerated together.
- No code or tests have been written yet; proceeding directly to bodies would
  violate the signature-first gate.
