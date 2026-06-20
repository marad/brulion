# Brulion — how we work

Browser-based, zero-config quick-capture notepad. Reads/writes plain `.md` files
in a folder on the user's disk via the File System Access API. No backend, no
cloud, hosted as a static site on GitHub Pages. Read `ROADMAP.md` first.

The product's origin and full vision live in the user's notes:
`pomysły/notatnik w przeglądarce.md` (see the global `~/.claude/CLAUDE.md` for
where the notes are and how to read them).

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
A **milestone** (`ROADMAP.md`) is split into **phases** (`milestones/MX.md`).

**Before a milestone's phases:** settle its open decisions *with the user* —
discuss them one topic at a time (the `elicit` skill), don't batch-dump
questions or guess silently — and log each in `DECISIONS.md`.

**Each phase runs the same assembly line, one phase at a time:**

1. **Spec** it with **specman** (`/spec`) — Intent + Given/When/Then ACs — before
   any code. One spec per phase (`FEAT-000N`); keep it to that phase's scope.
2. **Implement** with **`chisel`** (small change, ~1–3 files) or **`excavate`**
   (larger feature / new module). Load-bearing decisions stay explicit; tests
   before bodies.
3. **Review**: run **`/code-review --fix`** in a loop until no noteworthy
   findings remain (it has caught real concurrency bugs and weak tests here —
   take it seriously, and improve tests it flags).
4. **Verify & seal**: `specman verify` then `specman seal`. Every implementation
   commit carries a `Spec: FEAT-000N/AC-M` trailer.
5. **Ship**: push to `main` → GitHub Actions redeploys to Pages. Tick the phase
   in `milestones/MX.md` only once its "**Done =**" is met.

The author orchestrates this end-to-end and pauses only where the user is
genuinely needed: open decisions, and **manual browser verification** of
anything the File System Access API gates (native folder picker, OS permission
prompt, real-disk writes surviving a browser restart) — those cannot be
automated.

## Testing

Two layers (see `DECISIONS.md` → "Testing"):

- **vitest + happy-dom** (`src/**/*.test.ts`) — logic and DOM glue with the FSA
  mocked. Fast; runs inside `npm run build` / `specman verify`.
- **Playwright + real Chromium** (`e2e/**/*.spec.ts`, `npm run e2e`) — the real
  FSA read/write/list/save paths, reached by stubbing `showDirectoryPicker` with
  an **OPFS** handle (a genuine `FileSystemDirectoryHandle`). Only the native
  picker + permission prompt stay manual.

## Conventions

- **Repo docs, code, commits, GitHub Issues: English.**
- Before starting real work on a milestone, settle its open decisions (listed in
  `ROADMAP.md` / the milestone file) rather than guessing — but log what you
  decide in `DECISIONS.md`.
- Keep the lean ethos: this is a weekend-scale project. Favor the simplest thing
  that holds.
