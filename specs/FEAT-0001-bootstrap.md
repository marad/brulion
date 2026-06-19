---
id: FEAT-0001
title: bootstrap
status: draft
depends_on: []
---

## Intent

Before any product behavior is worth building, we need proof that the whole
delivery pipeline works end-to-end: that the toolchain compiles, that the editor
engine we committed to actually mounts, and — above all — that the chosen
zero-backend hosting (GitHub Pages) genuinely serves the app and updates on a
plain `git push`. This is deliberately the riskiest plumbing tackled first: if
Pages can't host a static Vite build under a secure context, every later
milestone is built on sand. The deliverable is an intentionally empty
application — a minimal shell with a CodeMirror editor that does nothing yet —
living on a real public URL. No folder access, no file I/O, no styling polish;
those are later phases. Success is purely "the pipe is connected, end to end".

## Behavior

The project builds with Vite + TypeScript, with **no UI framework** — plain
TypeScript owns the DOM (the framework-vs-vanilla decision is settled in
`DECISIONS.md`; CodeMirror is framework-agnostic and the M1 UI is a single
mount point). The app shell mounts one CodeMirror 6 editor instance into the
page so the toolchain is proven to wire CM6 correctly, not merely render static
HTML. The editor is empty and unstyled beyond CodeMirror defaults.

Deployment is by GitHub Actions to GitHub Pages on push to the default branch.
Because Pages serves a project site under a `/<repo>/` sub-path, the Vite build
must be configured with the matching `base` so bundled assets resolve at the
deployed URL rather than 404-ing. A push to the default branch triggers the
workflow, which builds and publishes, and a browser refresh shows the new
version.

## Constraints

- No UI framework in M1 — vanilla TypeScript only.
- No File System Access API, no folder picking, no persistence — later phases.
- No typography or visual polish beyond CodeMirror defaults — that is Phase 5.
- Vite `base` must match the GitHub Pages project sub-path.

## Out of scope

- Folder access, handle persistence, reading/writing `start` (Phases 2–4).
- Editor styling / typography (Phase 5).
- Any multi-note UI, syntax hiding, links, PWA (later milestones).

## Acceptance criteria

**AC-1** — Production build succeeds.
Given a clean checkout of the repository,
When `npm install` and `npm run build` are run,
Then the build exits successfully and emits a static bundle (a `dist/`
directory containing an `index.html` and the bundled JS/CSS).

**AC-2** — The shell mounts a CodeMirror 6 editor.
Given the built (or dev-served) application is loaded in a browser,
When the page finishes loading,
Then a single CodeMirror 6 editor instance is mounted and focusable in the app
shell (an editable empty editor is present, not just static markup).

**AC-3** — A GitHub Pages deploy workflow exists and is correct.
Given the repository's `.github/workflows/`,
When the workflow file is inspected,
Then there is a workflow triggered on push to the default branch that builds the
Vite project and deploys the produced bundle to GitHub Pages.

**AC-4** — The app is live at the GitHub Pages URL.
Given the workflow has run successfully,
When the public GitHub Pages URL is fetched,
Then the response is HTTP 200 and serves the application shell (an identifiable
marker — e.g. the document title — is present and the bundled script is
referenced with correctly resolved asset paths).

**AC-5** — `git push` redeploys the live site.
Given an observable change is committed (e.g. the document title text) and
pushed to the default branch,
When the deploy workflow completes,
Then fetching the GitHub Pages URL again reflects the changed content,
confirming push-to-redeploy works.
