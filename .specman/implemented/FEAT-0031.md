---
id: FEAT-0031
title: Welcome first-run screen
status: draft
depends_on: []
---

## Intent

Before a folder is open, Brulion greets the user with a bare blinking editor and a
lone "Open folder" button — uninviting and unexplained. This phase replaces that
pre-folder state with a deliberate first-run screen: the product name, a one-line
pitch, the file-fidelity promise stated as a feature ("plain `.md` files on your
disk, nothing uploaded"), and the primary open-folder call to action (with the
resume-access variant when a folder was previously granted). It also makes the
header contextual — a persistent wordmark, with the in-note controls appearing
only once a folder is open. Pure UI on the existing foundation: no file behavior
changes, the moat is untouched.

## Behavior

**Welcome hero.** A `#welcome` element is shown while no folder is open. It
contains the **Brulion** name, a short pitch, a one-line file-fidelity
reassurance, and the **Open folder** button — plus the **Resume folder access**
button, surfaced in exactly the case the existing restore flow surfaces it (a
remembered folder whose permission needs re-granting). The open/restore/resume
logic is the existing `ui.ts` flow with its buttons relocated into the hero, not
reimplemented.

**Workspace swap.** When a folder opens (fresh pick, resume, or silent restore),
the hero is hidden and the normal workspace — sidebar + editor — is shown. This is
a single view-state flip, exposed as a small tested helper rather than scattered
`hidden` assignments.

**Contextual header.** The header carries a persistent **Brulion** wordmark.
Before a folder is open it shows only the wordmark and — when the browser offers
it — the Install button (FEAT-0030), which is independent of folder state. After a
folder is open it additionally shows the sidebar toggle (`☰`), the Vim toggle, and
a re-pick **Open folder** affordance.

**Re-pick.** With a folder open, the header's re-pick **Open folder** runs the
same open flow as the welcome CTA, so the user can still switch to a different
folder (the single-folder model is unchanged; workspaces remain future).

## Constraints

- **Moat untouched.** Showing or toggling the welcome screen reads/writes nothing
  in the user's folder. Opening still seeds/loads per FEAT-0004; the save, poll,
  conflict, tree, link, Vim, and sidebar-collapse behaviors are unchanged.
- **Lean.** Vanilla TS + CSS, reusing `header button` styling and the `hidden`
  attribute (and/or a CSS class) for the state flip. No framework, no new
  dependency, no persisted state (the welcome screen is derived from "is a folder
  open", which the controller already drives).
- **No regression.** All pre-folder and post-folder controls keep their existing
  wiring; only their location/visibility changes.

## Out of scope

- Workspaces / multiple folders, an onboarding tour, animations.
- Any change to the empty-folder-after-open behavior (FEAT-0004 seed).

## Acceptance criteria

**AC-1** — The welcome hero greets the user before any folder is open.
Given the app loaded with no folder open,
When the initial view renders,
Then the `#welcome` hero is visible showing the Brulion name, a pitch, the
file-fidelity line, and the **Open folder** button, and the sidebar is hidden.

**AC-2** — Opening a folder swaps the hero for the workspace.
Given the welcome hero is showing and the in-note header controls are hidden,
When the folder-open view helper runs (a folder was opened),
Then `#welcome` becomes hidden and the sidebar, the sidebar toggle, the Vim
toggle, and the re-pick Open-folder control all become visible.

**AC-3** — The header is contextual: bare before a folder, full after.
Given the initial pre-folder DOM,
When the header is inspected,
Then the Brulion wordmark is present, and the sidebar toggle, Vim toggle, and
re-pick Open-folder control are all `hidden` (the Install button's visibility is
governed independently by FEAT-0030).

**AC-4** — End to end: welcome → open folder → workspace, and the hero stays gone.
Given the running app with no folder open (welcome visible),
When a folder is opened through the welcome CTA,
Then the hero hides, the editor and sidebar show, and the hero does not reappear.

**AC-5** — End to end: re-pick a different folder after one is open.
Given a folder is already open (workspace showing),
When the header re-pick Open-folder control is used to open another folder,
Then the app opens it (its notes list reflects the new folder) without the welcome
hero reappearing.
