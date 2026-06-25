---
id: FEAT-0059
title: Vault model and per-window identity
status: draft
depends_on: [FEAT-0003, FEAT-0031, FEAT-0036]
---

## Intent

Brulion remembers exactly one folder: the directory handle lives under a single
origin-global key in IndexedDB (FEAT-0003), and every window restores *that* handle
on reload. Two real frictions follow. First, returning to a folder you used before
means re-picking it through the native OS picker every time — there is no memory of
"the folders I work in". Second, opening two windows on two different folders is
unstable: because both windows read the same global handle, a reload in one window
can silently swap it onto the *other* window's folder, losing your place.

This phase reworks the foundation for both: persist a **set** of granted folders
("vaults") instead of one, and give each window a **stable vault identity in its
URL** so a reload re-attaches to the same vault. It does not yet add the switching UI
(that is FEAT-0060) — adding a folder is still the native picker. It is storage and
window-identity only; **no note bytes are touched** (the moat): vault handles live in
IndexedDB, never in the user's folders.

## Behavior

**The vault set.** A vault is `{ id, handle, name }`: `handle` is the granted
`FileSystemDirectoryHandle`, `name` its folder name (display only), and `id` a short
**opaque generated** identifier, stable for the life of the vault and independent of
the folder name. The set persists in IndexedDB. Adding a folder (the native picker)
appends it to the set; picking a folder already in the set (detected by
`isSameEntry` against the stored handles) reuses the existing vault rather than
duplicating it.

**Migration.** A pre-M33 user has a single handle under the legacy key and no vault
set. On first load after this phase, that handle is migrated into the set as the
first vault (with a fresh id and its folder name); the user notices nothing.

**Per-window identity.** The open vault's `id` is mirrored into the window's URL as a
`?ws=<id>` query parameter (via the History API, replacing — not pushing — so it
doesn't add history entries). Combined with the existing `#/path` note hash
(FEAT-0036), the URL fully describes the window's state. On load:

- If `?ws=<id>` names a vault in the set, the window re-attaches to **that** vault
  (re-granting permission if the handle lost it — same resume-button flow as today),
  regardless of what other windows have open.
- If there is no `?ws` (a fresh window, or a bookmark without one), the window falls
  back to the most-recently-used vault (the migrated legacy folder, for an upgrading
  user), stamping its `?ws` once attached.
- If the set is empty (a brand-new user), the welcome screen shows as today; opening
  a folder creates the first vault and stamps `?ws`.

So a reload always returns the window to its own vault; two windows with different
`?ws` stay independent.

**Out-of-window changes.** Session state other than the vault+note (recency, expanded
folders, sidebar width/collapse) remains origin-global in this phase — unchanged
storage, shared across vaults. Only the vault identity and the open note are
per-window (via the URL).

## Constraints

- **One persistence mechanism.** The vault set rides the existing `idb-keyval` layer
  (a new key), like every other persisted preference — no new store/database.
- **Reuse the open path.** Attaching a vault (on load, or on a fresh pick) goes
  through the existing controller open + permission flow (FEAT-0002/0003/0031); this
  phase changes *which* handle is chosen and records the set, not how a folder opens.
- **`?ws` is set with `replaceState`,** never a push, so vault identity never litters
  the back/forward history (which belongs to note navigation, FEAT-0036).
- **Moat: no note writes.** The vault set, ids, and `?ws` are browser-private; no
  `.md` file (and not even `.brulion.json`) is read or written by this phase.

## Out of scope

- **The vault switcher UI** — a palette action + chooser to switch between granted
  folders, and a surface to forget a vault, is FEAT-0060 (P2). Here, adding a folder
  is still the native picker and there is no in-app switch control.
- **Per-vault session state** — recency / expanded folders / sidebar width stay
  global; making them per-vault is a later follow-up.
- **Cross-window live sync** — two windows don't push state to each other beyond what
  the existing disk poller already does; this phase only stops them from clobbering
  each other's *vault identity* on reload.

## Acceptance criteria

**AC-1** — Opening a folder records it as a vault and stamps the window's `?ws`.
Given no folder is open,
When the user picks a folder,
Then it is added to the persisted vault set with a generated id and its name, the
folder opens, and the window's URL carries `?ws=<that id>`.

**AC-2** — A reload re-attaches the window to its `?ws` vault.
Given a window has a folder open with `?ws=<id>` in its URL and permission is still
granted,
When the window reloads,
Then it re-attaches to the vault with that id and opens it (no picker, no folder
swap).

**AC-3** — Two windows on different vaults stay independent across reload.
Given two windows are open on two different granted vaults (distinct `?ws`),
When either window reloads,
Then it returns to its own vault — not whichever folder was opened last in the other
window.

**AC-4** — Re-picking an already-known folder reuses its vault, not a duplicate.
Given a folder is already in the vault set,
When the user picks that same folder again through the native picker,
Then the existing vault is reused (matched by `isSameEntry`) and no duplicate entry
is added; the window attaches to it with the same id.

**AC-5** — A pre-M33 single-folder user is migrated transparently.
Given a stored legacy single handle and no vault set (the pre-M33 state),
When the app loads,
Then that handle becomes the first vault (fresh id, its folder name), the window
attaches to it and stamps `?ws`, and the user sees their folder as before.

**AC-6** — A fresh window with no `?ws` falls back to the most-recent vault.
Given at least one vault exists and a window loads with no `?ws` in its URL,
When the restore runs,
Then the window attaches to the most-recently-used vault and stamps its `?ws`.

**AC-7** — Re-granting permission still works per window.
Given a window's `?ws` vault handle has lost readwrite permission,
When the window loads,
Then it shows the resume-access affordance (as today) and, once the user grants,
attaches to that vault.

**AC-8** — `?ws` uses replaceState and doesn't pollute history.
Given a window attaches to or switches vault,
When `?ws` is written,
Then it replaces the current history entry (no new back/forward step is created for
the vault identity).

**AC-9** — No note bytes are written.
Given any of the above (open, reload, migrate, re-pick),
When the vault set and `?ws` are updated,
Then no `.md` file is created or modified by this phase.
