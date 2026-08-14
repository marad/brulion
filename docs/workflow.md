# Brulion workflow

This is the executable version of the milestone → phase → spec →
implementation protocol. The repository is the record; chat is only a live
handoff.

## 1. Start or resume a milestone

Before editing:

```bash
git status --short --branch
node scripts/workflow-mapping-check.mjs
specman status --verbose
```

Read `AGENTS.md`, `ROADMAP.md`, `DECISIONS.md`, and the active
`milestones/MX.md`. The phase ledger must contain **Current phase**, **Last
completed gate**, and **Next action** (or **Exact next action**). A milestone
whose ledger says it is only defined/queued is not active; invoke `/skill:goal`
before treating its phase as work in progress.

A local full gate can use the ledger resolver rather than a historical default:

```bash
npm run workflow:gate -- ci
```

Pass `--milestone milestones/MX.md` only when deliberately checking a bounded
non-current target. CI and Pages deployment use the resolver and fail closed if
more than one milestone is genuinely open.

## 2. Spec and plan before production edits

Create one spec for the phase, validate it, and sync its plan before touching
production code or tests:

```bash
specman validate
specman sync FEAT-NNNN
git add specs/ .specman/plans/
git commit -m "plan: sync FEAT-NNNN"
```

The verification section of a plan must list executable checks only. It must
not invoke `specman verify FEAT-NNNN` for itself; the outer workflow owns that
command. The full gate checks this automatically.

## 3. Fast pre-review handoff

After implementation and targeted tests, give the reviewer an exact owned
range. The command is read-only: it never regenerates artifacts, edits plans,
or runs the six-minute browser suite.

```bash
BASE=$(git merge-base origin/main HEAD)
npm run workflow:gate -- pre-review --base "$BASE" --spec FEAT-NNNN
```

The output records the base, current HEAD, spec, and changed paths. It checks
whitespace, spec validity/status, verification-plan recursion, and the checked-in
Authoring Kit → `public/` byte pairs. Fix any finding before starting the
canonical review. Use targeted unit/browser tests while fixing a review round;
do not rerun the full suite for every small documentation or test correction.

### 3.1 Self-review handoff

Before the canonical reviewer starts, the writer performs a focused self-review
from the packet rather than relying on memory. The handoff records:

- the highest-risk ACs and failure modes;
- the targeted commands/probes run and their outputs;
- remaining uncertainties or untested boundaries;
- any suspected root-cause family already visible in the diff.

A self-review entry that only says “looks good” is incomplete. The pre-review
gate supplies base, HEAD, spec, and changed paths mechanically; the writer fills
only the semantic risk and evidence fields.

## 4. Canonical adversarial review

Run exactly one canonical reviewer session for the phase loop at **xhigh**
effort, read-only in the writer's current worktree (`worktree:false`), against
the current HEAD and exact base reported by pre-review. Resume that same
reviewer session for every follow-up round; do not launch a fresh context merely
because a fix changed HEAD. The only fresh context is the required final-clean
pass, also at xhigh and `worktree:false`. A disappeared, stopped, or blocked
worker is **blocked**, never clean.

Each phase milestone ledger gets a `## Review ledger` section. Append one record
per round:

```markdown
## Review ledger

- **Spec:** FEAT-NNNN
- **Base SHA:** <merge-base or explicit review base>
- **Reviewed HEAD:** <exact commit>
- **Self-review:** <risks>; `<command>`; `<result>`; <uncertainties>
- **Round 1:** clean | findings | blocked
  - **Findings:** <ids, symptom classes, root-cause families, severities, or none>
  - **Disposition:** <fix commit/test, or why no change>
  - **Evidence:** `<command>`; `<test>`; `<validation output>`
```

A clean verdict is valid only when the reviewer returned `clean`, all material
findings are disposed, and the ledger names the commands/tests that support it.
Every finding records both its symptom class and its **root-cause family**.
After two consecutive rounds in the same root-cause family, restructure the
cause instead of applying another effect-level patch, even when the symptoms
have different labels. Replace the reviewer session only when it is genuinely
blocked or failed, and record that replacement in the ledger before continuing.

## 5. Verification tiers, seal, and ship

Use three cost tiers:

1. **Iteration/review round:** targeted tests plus relevant typecheck/lint only.
2. **Phase close:** targeted tests, `specman verify`, `specman seal` (or
   `--initial` for a new snapshot), and `specman status --verbose`.
3. **Milestone close:** `specman validate`, full Vitest, build, and E2E.

After the review is clean, the phase-close commands are:

```bash
npm test -- --run <targeted files>
specman verify FEAT-NNNN
specman seal FEAT-NNNN       # or --initial for a new snapshot
specman status --verbose
```

The full gate runs the plan/artifact checks, workflow tests, Vitest, build, and
Chromium in order, stopping at the first failure. It is the shipping authority;
local hooks are convenience only. Update the phase ledger and tick the phase
checkbox only after verification and sealing. Remove disposable `.pi-subagents/`
output before the final clean-tree check, then push `main` only after the whole
milestone is closed. The commit-message hook mechanically enforces Spec trailers
for implementation/workflow paths.

## Evidence rules

- Review ranges use immutable commit ids, not a moving branch name alone.
- Tests added for a behavioral fix must fail against the pre-fix behavior.
- Checked-in generated files are compared, not silently repaired by a gate.
- Full E2E is the final confidence pass; targeted tests are the iteration loop.
- Substantive workers/reviewers have no hard wall-clock, turn, or tool timeout by
default. Attention is recovered by inspect/steer/resume, never by silently
accepting partial output.

## 6. Phase retrospective

Before ticking a phase checkbox, append `## Phase retrospective` to its
milestone ledger. Use this compact record:

```markdown
## Phase retrospective

- **Root-cause lesson:**
- **What caught it:**
- **Workflow action:**
- **Generality:** general workflow rule | feature-specific exception
```

Only general lessons change `AGENTS.md`, a project skill, or this document.
Feature-specific observations stay in the phase ledger and do not become new
ceremony.
