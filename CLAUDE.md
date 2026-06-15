# Brulion — how we work

Browser-based, zero-config quick-capture notepad. Reads/writes plain `.md` files
in a folder on the user's disk via the File System Access API. No backend, no
cloud, hosted as a static site on GitHub Pages. Read `ROADMAP.md` first.

## The guiding principle

The product's moat is **file fidelity**: plain markdown the user owns, no
lock-in. **Every technical decision defers to that.** When a choice trades file
purity for convenience, flag it explicitly — don't quietly take the convenient
path (this is why CodeMirror won over Tiptap; see `DECISIONS.md`).

## Where things live

- **`ROADMAP.md`** — thin top-level index: milestones, one-line goals, scope
  (in/out). Keep it readable from a bird's-eye view; don't bloat it with phase
  detail.
- **`DECISIONS.md`** — ADR-lite log. Every non-trivial decision gets an entry:
  _what_ and _why_. Append newest at the bottom. This is what stops us
  re-litigating settled choices in a future session.
- **`milestones/MX.md`** — per-milestone detail, phases as sections, each with a
  concrete "**Done =** …". Created **lazily**, only when a milestone goes active.
  Don't pre-build empty folders/files. Phase progress is tracked with checkboxes
  at the top of the file — tick a phase when its "Done =" is met.
- **GitHub Issues** — for granular execution tracking, once the repo is pushed.

## Workflow

Work descends through four levels: **milestone → phase → spec → implementation**.

- A **milestone** (`ROADMAP.md`) is split into **phases** (`milestones/MX.md`).
- A phase is turned into a concrete plan with the **`spec`** skill before any code.
- A spec'd phase is **implemented** with `excavate` (top-down design for a larger
  feature/module) or `chisel` (small change, ~1–3 files, no new module).

## Conventions

- **Repo docs, code, commits, GitHub Issues: English.**
- Before starting real work on a milestone, settle its open decisions (listed in
  `ROADMAP.md` / the milestone file) rather than guessing — but log what you
  decide in `DECISIONS.md`.
- Keep the lean ethos: this is a weekend-scale project. Favor the simplest thing
  that holds.
