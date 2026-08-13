# Workflow evidence gates — signature fit

The implementation extends the existing workflow gate modules rather than
creating a new process. These are the contracts that tests will exercise.

## Signatures

```ts
type MilestoneDiscovery =
  | { ok: true; path: string; reason: "active" | "latest-closed" }
  | { ok: false; errors: WorkflowError[] }

discoverMilestonePath(root: string): MilestoneDiscovery

findRecursiveVerification(planId: string, planText: string): string[]
checkVerificationPlans(root: string): WorkflowError[]

checkDerivedArtifacts(root: string): WorkflowError[]

runPreReviewGate(request: {
  root: string
  base: string
  specId: string
  milestonePath?: string
}): PreReviewResult
```

`runPreReviewGate` is observational and returns a structured result or a
blocking error; it does not throw for expected repository drift. The CLI
adapter owns exit codes and formatting. The full-gate planner consumes the
same pure plan/artifact checks but keeps command execution sequential and
first-failure stopping.

## Traces

1. **One active milestone:** CLI without a path → resolver reads ledgers → one
   open ledger returns its relative path → full plan passes that path to
   preflight. No historical default is consulted.
2. **Final shipping with all ledgers closed:** CLI without a path → resolver
   parses all closed ledgers → highest numeric filename is selected → preflight
   validates that final ledger. An explicit path bypasses discovery.
3. **Recursive plan:** plan checker extracts only `## Verification` → same FEAT
   command is found → structured violation names the plan and FEAT → full gate
   stops before tests; prose outside that section is ignored.
4. **Derived drift:** artifact checker reads source/generated pair → bytes differ
   → pre-review reports the pair and exits nonzero without copying either file.
5. **Review handoff:** pre-review validates base object and spec → computes
   `base...HEAD` paths and whitespace → runs plan/artifact checks → returns
   evidence; it never invokes the full E2E command.

## Fit findings

- The resolver and invariant functions are pure/read-only at their boundaries;
  no caller needs a second normalized milestone representation.
- The CLI should not infer a spec from the changed files: `--spec` is required
  for pre-review so the reviewer cannot accidentally inspect the wrong feature.
- Plan recursion is deliberately a pure text check; invoking Specman during the
  check would be slower and could hide the exact reason for failure.
- Artifact pairs are fixed because the Authoring Kit has three declared public
  derivatives today; adding another derivative must update the pair list and
  its test in the same implementation commit.
- Review ledger writing stays in the protocol/documentation layer. The gate
  cannot safely append a verdict because it does not own reviewer judgment.

## Self-review

A fresh trace shows no pass-through function that deserves merging: resolver,
checks, observer, and orchestrator have distinct owners. A generic plugin list
for arbitrary generated artifacts was considered and rejected as unnecessary
configuration for the current three-pair contract. A `--test` hook was also
rejected; phase-specific targeted tests belong in the handoff and spec plan,
not in a gate that guesses commands.
