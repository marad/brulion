---
id: FEAT-0060
title: Workspace switcher and forget
status: draft
depends_on: [FEAT-0057, FEAT-0058, FEAT-0059]
---

## Intent

FEAT-0059 made the app remember a **set** of granted folders (vaults) and gave each
window a stable vault identity, but left no in-app way to actually *switch* between
them — adding a folder is still the native picker, and there's no surface to drop a
folder you no longer use. This phase adds the switching UX: a command-palette action
that lists the granted workspaces for one-click switching (re-granting permission if
the folder lost it), and a settings surface to forget a workspace.

It is pure UI/UX over the FEAT-0059 vault store and the FEAT-0057 command palette;
**no note bytes are touched** (the moat) — switching just attaches the window to an
already-granted folder through the existing path, and forgetting only removes the
handle from the browser-private set.

## Behavior

**Switch workspace.** A registered action **"Switch workspace…"** opens the command
palette populated with one row per granted vault (its folder name), fuzzy-searchable
like any palette list. Choosing a workspace switches the window to it: if its handle
still has permission it attaches immediately; if permission was lost, it requests it
(the click is a user gesture) and attaches on grant, or stays put if declined.
Switching points the window at the chosen vault and updates its `?ws` (FEAT-0059).
The currently-open workspace is excluded from the list (you can't switch to where you
already are), mirroring the quick switcher's omit-active rule.

**The chooser reuses the palette.** Rather than a third bespoke overlay, the switcher
opens the existing command palette (FEAT-0057) with a transient action list (the
vaults), reusing its fuzzy-search, keyboard nav, and styling. When there is no other
workspace to switch to, the action is still runnable but the list is empty.

**Forget a workspace.** The settings modal gains a **Workspaces** section listing the
granted vaults by name, each with a control to forget it (remove it from the set).
Forgetting only drops the handle from the persisted set; it never deletes the folder
or its files. The **currently-open** workspace cannot be forgotten (no control, or a
disabled one) — you can't pull the vault out from under the open window.

## Constraints

- **Reuse, don't fork.** The switcher reuses the FEAT-0057 command palette (opened
  with a transient action list); it does not add a new overlay. Switching reuses the
  FEAT-0059 attach flow and permission helpers; forgetting reuses `removeVault`.
- **Moat: no note writes.** Switching and forgetting touch only the vault set
  (IndexedDB) and the URL; no `.md` file (nor `.brulion.json`) is created or modified.
- **Folder-add stays the native picker.** This phase adds switching/forgetting among
  *already-granted* folders; adding a new one is still "Open folder" / "Switch
  folder…" through the OS picker (FEAT-0054/0059).

## Out of scope

- **Per-vault session state beyond FEAT-0059** (recency/expanded already per-vault;
  sidebar width/collapse stay global).
- **Renaming a workspace** — the display name is the folder name; no in-app rename.
- **Reordering the workspace list** — it is most-recent-first (FEAT-0059); no manual
  ordering control.

## Acceptance criteria

**AC-1** — "Switch workspace…" lists the other granted workspaces.
Given two or more granted vaults and one open,
When the user runs the "Switch workspace…" action,
Then the command palette opens listing the granted workspaces by folder name,
excluding the currently-open one.

**AC-2** — Choosing a workspace switches the window to it and updates `?ws`.
Given the switcher list is open,
When the user chooses another workspace whose permission is still granted,
Then the window attaches to that vault (its notes load) and its `?ws` updates to that
vault's id.

**AC-3** — Switching re-grants permission when the handle lost it.
Given a listed workspace whose handle no longer has permission,
When the user chooses it,
Then permission is requested (a user gesture) and, on grant, the window attaches to
it; if declined, the open workspace is unchanged.

**AC-4** — The settings Workspaces section lists the granted workspaces.
Given one or more granted vaults,
When the user opens the settings modal,
Then a Workspaces section lists them by folder name.

**AC-5** — Forgetting a workspace removes it from the set.
Given a non-open workspace in the list,
When the user forgets it,
Then it is removed from the persisted vault set (gone from the list and from a later
"Switch workspace…"); no folder or file is deleted.

**AC-6** — The open workspace cannot be forgotten.
Given the settings Workspaces section,
When the user looks at the currently-open workspace's row,
Then it offers no enabled forget control (the open vault can't be pulled out from
under the window).

**AC-7** — No note bytes are written.
Given a folder is open,
When the user switches workspaces and forgets a workspace,
Then no `.md` file is created or modified.
