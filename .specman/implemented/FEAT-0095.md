---
id: FEAT-0095
title: Project-local workflow command mapping
status: draft
depends_on: []
---

## Intent

The repository process currently names `/goal` and `/code-review` as if they
were available commands, although this pi runtime discovers project skills as
`/skill:<name>` commands. That mismatch lets an agent claim to have followed a
workflow that it could not actually invoke. The repository needs a
versioned, project-local command mapping whose instructions are discoverable in
any trusted Brulion session and whose names match the real pi command model.

## Behavior

The project provides a `goal` skill for starting or resuming a milestone and a
`code-review` skill for reviewing the current diff. A `review-until-clean` skill
explains the bounded review loop and delegates each round to `code-review`.
These skills are project-local under `.pi/skills/`, so the mapping travels with
the repository rather than depending on a user's global setup.

`AGENTS.md` names the real commands (`/skill:goal`, `/skill:code-review`,
`/skill:review-until-clean`, and the `specman` CLI) and explicitly records the
mapping from the historical bare names. It does not claim that a missing bare
command was executed. The goal and review instructions preserve the existing
workflow gates: preflight and phase ledger before mutation, spec and sync before
implementation, isolated mutation worktrees, read-only reviewers, and no hard
wall-clock timeout for substantive workers.

The mapping is documentation and skill content only. It does not modify
production code, user markdown, global pi configuration, or the behavior of the
application.

## Acceptance criteria

- AC-1: Given a trusted Brulion checkout in pi, when project skills are
  discovered, then `.pi/skills/goal/SKILL.md`,
  `.pi/skills/code-review/SKILL.md`, and
  `.pi/skills/review-until-clean/SKILL.md` each have valid Agent Skills
  frontmatter and describe the corresponding workflow command.
- AC-2: Given an agent follows `AGENTS.md`, when it needs milestone kickoff,
  review, or the review loop, then the document points to the actual
  `/skill:goal`, `/skill:code-review`, and `/skill:review-until-clean` command
  forms and does not present the unavailable bare names as invocable commands.
- AC-3: Given the goal skill is invoked, when it starts or resumes a milestone,
  then its instructions require the documented preflight, durable phase ledger,
  spec-before-code, sync-before-implementation, worktree isolation, and
  explicit recovery after compaction or worker failure.
- AC-4: Given the code-review and review-until-clean skills are invoked, when a
  diff is reviewed, then the instructions require discriminating tests for
  fixes, restructuring after two rounds of the same finding class, and a
  clean stopping condition; they do not authorize silently treating a timed
  out mutation worker as successful.
- AC-5: Given the project-local skills are absent from a fresh checkout, when an
  agent runs the preflight mapping check, then it fails with the missing paths
  and does not claim that the corresponding workflow gates ran.
- AC-6: Given the mapping is installed, when the project-local skill files and
  `AGENTS.md` are inspected, then no instruction asks a substantive worker to
  receive a hard wall-clock, hard turn, or hard tool timeout by default.

## Out of scope

- Implementing the workflow runner, Git hooks, or GitHub Actions gates; those
  are subsequent phases with their own specs.
- Registering global pi skills or changing a user's home configuration.
- Changing the product, its `.md` file format, or the extension API.
