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

**Operating pattern: build first with `/goal`, review after with `/elicit`.**
Kick a milestone off with **`/goal`** (e.g. *"implement MX"*) and build the
**whole** milestone — every phase, end-to-end, autonomously — without stopping
between phases. Only once it's implemented and deployed, run the **milestone
review with `/elicit`** to talk through the recorded decisions and apply any
corrections. Don't invert this (no per-decision questions mid-build); the review
is the single, batched, live checkpoint at the end.

**Decisions are made autonomously, reviewed at the end.** Don't stop to ask the
user about a milestone's open decisions up front. Make the call yourself — pick
the option that best serves the **file-fidelity moat** and the **lean ethos** —
and **record each decision in `DECISIONS.md` with its _what_, _why_, and its
concrete consequences for the UI and the project**. Then keep going. The user
reviews the whole batch only once the milestone is implemented (see "Milestone
review").

**Each phase runs the same assembly line, autonomously, one phase at a time.**
These steps are a checklist in order, not suggestions — **MUST**, not "should".
"I already know the design" is not a reason to skip a step; that rationalization
is exactly what these rules exist to stop (it has cost us real bugs — a rendering
contract bug that a tests-first pass would have caught surfaced only from a user
report instead).

1. **Spec** it with **specman** (`/spec`) — Intent + Given/When/Then ACs — before
   any code. One spec per phase (`FEAT-000N`); keep it to that phase's scope.
2. **Plan with `specman sync` BEFORE writing any code.** The sync plan is the
   implementation guide, not paperwork generated afterward. Implement from it.
3. **Implement by invoking the skill — always:** **`excavate`** for any **new
   module** (top-down: module diagram → signature stubs → signature-fit review →
   tests → bodies), **`chisel`** for a **small change** (~1–3 files, no new
   module). Do **not** hand-write a module straight into existence. **Tests come
   before bodies** — write the failing test first, then the implementation
   (`excavate`/`chisel` enforce this; honor it even on the rare direct edit).
4. **Review**: run the loop via **`/review-until-clean`** (which loops
   **`/code-review --fix`**, every phase — not an ad-hoc reviewer) until no
   noteworthy findings remain (it has caught real concurrency bugs, data-loss
   bugs, and weak tests here — take it seriously, and improve tests it flags).
   Honor that skill's two rules: **restructure after 2 rounds of the same class
   of finding** (stop patching effects, fix the cause), and make every test added
   for a fix **discriminating** (it must fail against the pre-fix behavior).
5. **Verify & seal**: `specman verify` then `specman seal`. Every implementation
   commit carries a `Spec: FEAT-000N/AC-M` trailer.
6. **Ship**: push to `main` → GitHub Actions redeploys to Pages. Tick the phase
   in `milestones/MX.md` only once its "**Done =**" is met.

Drive this end-to-end without pausing for the user — don't seek approval
between phases. The only hard stops are steps that genuinely can't proceed
without them (e.g. an irreversible, outward-facing action). Anything the File
System Access API gates and that can't be automated (native folder picker, OS
permission prompt, real-disk writes surviving a browser restart) is checked
*together with the user during the milestone review*, on the live app.

## Milestone review

Once the whole milestone is implemented and deployed, review it **with the user
via the `elicit` skill** (one decision at a time), against the live app: walk
through every decision recorded for the milestone, spell out its consequences in
the UI and the project, and let the user confirm or change each on the spot.
This is the moment for course-correction — cheap because it's batched and live,
not a stream of mid-build questions. Apply the changes the user asks for, then
the milestone is done.

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
- Make a milestone's open decisions yourself as you go — decide deliberately
  (best for the moat + lean ethos), never guess silently — and log each in
  `DECISIONS.md` with its UI/project consequences. Review them with the user
  only at the milestone review, not before or during the build.
- Keep the lean ethos: this is a weekend-scale project. Favor the simplest thing
  that holds.
