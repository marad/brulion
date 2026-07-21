---
id: FEAT-0080
title: Workspace name field in the settings modal
status: draft
depends_on: [FEAT-0079, FEAT-0047, FEAT-0048]
---

## Intent

FEAT-0079 made a note permalink portable by keying `?ws=` on a vault's **effective
name** — the `workspace` field in `.brulion.json`, defaulting to the folder name.
But it gave no way to *set* that field: portability only worked when the folder is
named the same on every device. This phase adds the missing control — a "Workspace
name" field in the M16 settings modal — so a user whose folder is named differently
across machines (say `~/Sync/notes` on one and `D:\backup` on another) can pin an
explicit, shared name (`notes`) and get one working permalink everywhere.

It is a small UI addition on the existing settings surface (FEAT-0048) writing the
existing settings file (FEAT-0047). The only twist beyond a plain settings field is
that the name is also the **live vault identity**: changing it must immediately
refresh the vault's cached name and re-stamp the current window's `?ws`, so the URL
in the address bar is portable *now*, without waiting for a reload/reattach.

## Behavior

**The field.** The settings modal gains a "Workspace name" text field, seeded from
the current settings' `workspace` value and reseeded by the modal's `sync()` like
the other fields. Its **placeholder is the open folder's name**, so an empty field
visibly means "use the folder name" (the FEAT-0079 default) rather than looking
unset/broken.

**Persisting.** Editing the field flows through the same settings-save path as
every other field (FEAT-0047): the value is written to `workspace` in
`.brulion.json`. No new persistence.

**Live identity.** Because the effective name drives `?ws` (FEAT-0079), a change to
this field additionally, for the **currently attached** vault: refreshes its cached
`workspace` name (so a later startup resolves the new name without a disk read) and
re-stamps the window's `?ws` to the new effective name (the new `workspace`, or the
folder name when cleared). This reuses the same cache-write and stamp helpers the
attach path uses; it does not touch note bytes.

## Constraints

- **Reuse the settings pipeline.** The field rides the existing modal → settings
  patch → `saveSettings` flow (FEAT-0047/0048); no bespoke persistence.
- **Reuse the FEAT-0079 helpers.** The cache refresh and `?ws` re-stamp go through
  the same functions the attach path uses (`markVaultAttached`, the stamp +
  `effectiveVaultName`), not a parallel implementation.
- **Moat.** The only file written is `.brulion.json` (already the settings file);
  no `.md` bytes are touched.

## Out of scope

- **Uniqueness / collision warnings** — the field does not check whether the chosen
  name collides with another granted vault's effective name; collision resolution is
  the documented FEAT-0079 most-recent tiebreak, not a validation concern here.
- **Cross-window propagation** — other open windows on the same vault refresh their
  cached name on their next attach, not live.

## Acceptance criteria

**AC-1** — The modal shows a Workspace name field seeded from settings.
Given the settings modal opens with the current settings' `workspace` = `N`,
When it renders,
Then a "Workspace name" text field is shown with its value set to `N` (empty when
`workspace` is unset).

**AC-2** — The placeholder is the folder-name default.
Given the open folder is named `F` and `workspace` is empty,
When the field renders,
Then its placeholder shows `F`, signalling that an empty field uses the folder name.

**AC-3** — Editing the field persists `workspace` to `.brulion.json`.
Given the settings modal is open,
When the user types a name `N` into the Workspace name field,
Then `workspace` = `N` is written to `.brulion.json` via the existing settings-save
path.

**AC-4** — Setting a name updates the live `?ws` and the cached vault name.
Given a vault is attached and its window carries `?ws=<old>`,
When the user sets the Workspace name to `N`,
Then the window's `?ws` becomes `N` and the vault's cached `workspace` becomes `N`
immediately (no reload), so a reload re-resolves to the same vault by the new name.

**AC-5** — Clearing the field falls back to the folder name.
Given the Workspace name field held a name and the vault's folder is `F`,
When the user clears the field,
Then `workspace` is stored empty, and the live `?ws` and cached effective name fall
back to `F`.

**AC-6** — Only `.brulion.json` is written.
Given any edit to the Workspace name field,
When it is saved and the live identity updates,
Then no `.md` file is created or modified (only `.brulion.json`, plus the
browser-private vault cache and URL).
