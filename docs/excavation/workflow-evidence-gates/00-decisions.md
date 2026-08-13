# Workflow evidence gates — decisions

## Goal

Reduce avoidable review rounds and stale handoffs while keeping the existing
fail-closed quality gate authoritative.

## Decisions

- **Extend the existing Node workflow scripts.** No new dependency, service, or
  process boundary is justified for repository checks.
- **Checks are read-only.** Pre-review and artifact checks report drift; they do
  not regenerate `public/` files, edit plans, create commits, or repair ledgers.
- **Milestone selection is ledger-based.** One non-closed phase ledger is the
  active target. More than one is ambiguous and blocks. If all tracked
  milestones are closed, the numerically latest one is the final-shipping
  target; an explicit CLI path always overrides discovery.
- **Plan recursion is scoped to executable verification commands.** A prose
  mention of `specman verify FEAT-NNNN` is harmless; a command in that plan's
  `## Verification` section is rejected because it would recurse.
- **Derived artifact checking is explicit and byte-for-byte.** The checked-in
  Authoring Kit sources remain authoritative; the three committed `public/`
  copies are compared, never silently rewritten.
- **Review evidence belongs in the milestone ledger.** The ledger records the
  base SHA, reviewed HEAD, round/status, findings/dispositions, and command or
  test evidence. Generated subagent transcripts remain disposable and are not
  treated as project evidence.
- **Pre-review is a fast observational gate.** It checks range/spec/plan/
  artifact invariants and leaves targeted tests to the phase owner. The full
  Vitest/build/Chromium sequence remains mandatory before shipping.

## Deferred

- GitHub branch protection remains an external repository setting and is not
  inferred or mutated by these scripts.
- The pre-review command does not choose which phase-specific application tests
  to run; the phase plan and reviewer handoff name those explicitly.

## Self-review

The design was reconsidered against two alternatives: a new standalone workflow
service, rejected as unnecessary process weight, and automatic artifact repair,
rejected because it would conceal source drift in a file-fidelity project. A
separate generated review database was also rejected; the existing milestone
Markdown is the durable, reviewable project record. The remaining checks are
subtractive and read-only, so no state migration or new runtime boundary is
needed.
