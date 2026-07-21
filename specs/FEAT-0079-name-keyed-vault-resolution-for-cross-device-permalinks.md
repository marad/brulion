---
id: FEAT-0079
title: Name-keyed vault resolution for cross-device permalinks
status: draft
depends_on: [FEAT-0036, FEAT-0059, FEAT-0047]
---

## Intent

A note's full permalink is `?ws=<vault>#/path/to/note` — the `?ws` names the
vault (FEAT-0059) and the `#/…` hash names the note within it (FEAT-0036). The
hash is already portable: the same relative path resolves in any copy of the
folder. But `?ws` carries a **random, per-machine opaque id**, minted when the
folder was first granted on that device. So the *same* synced folder gets a
different `?ws` on every machine, and a permalink generated on one device is a
dead link on another — even though the user owns the same files there.

This phase makes `?ws` resolve by a **stable workspace name** instead, so the
whole URL becomes portable across the user's own devices. The name comes from the
`workspace` field in `.brulion.json` (FEAT-0047) — which already travels with the
folder (FEAT-0047) — falling back to the folder's own name when unset, so the
common case (one folder, same name everywhere) is portable with no configuration.
Existing `?ws=<opaque-id>` links keep resolving. Moat-neutral: the note is still
addressed by its plain path, and no `.md` bytes are touched.

This is deliberately **cross-*own-devices*, not cross-*any-machine***: the File
System Access API cannot silently locate "the folder called notes" on a machine
that never granted it, so a permalink there degrades to the normal welcome/pick
flow — the `#/…` hash is preserved and the note opens once the right folder is
granted. It is a personal bookmark, not a sharing link.

## Behavior

**Effective workspace name.** Every vault has an *effective name*: the `workspace`
field from its `.brulion.json` when that is a non-empty string, otherwise the
folder name (`handle.name`, already stored as the vault's `name`). This is the
value a portable `?ws` carries and matches against. Defaulting to the folder name
means a user who names their synced folder the same on every device gets portable
links without touching any config; the explicit `workspace` field is the override
for when local folder names differ.

**The name is cached on the vault record.** The vault gains an optional cached
`workspace` field (the configured name from `.brulion.json`, or absent when
unset). It is refreshed every time the window attaches to that vault — the moment
we hold permission and read its settings anyway. Startup resolution matches `?ws`
against the *cached* effective name, so it needs **no disk read and no permission**
for vaults it isn't attaching to (a handle may not have permission re-granted yet
at load).

**Name-first, id-fallback resolution.** Given a `?ws=<ref>` on load:

- **Name match.** If one granted vault's effective name equals `<ref>`, attach to
  it.
- **Collision.** If more than one vault shares that effective name, the
  most-recently-used among them wins (the set is ordered most-recent-first) —
  names are not unique the way minted ids were, so this is a defined tiebreak, not
  an error.
- **Legacy id.** If no name matches, `<ref>` is retried as an opaque vault id
  (the pre-M38 meaning), so links already in browser history / bookmarks keep
  working.
- **Miss.** If nothing matches, fall back to the most-recent vault (as today when
  `?ws` is absent), leaving the `#/…` hash intact so the note resolves once a
  folder is granted.

**Portable stamp.** When a window attaches to a vault, the `?ws` it stamps into
the URL is the vault's **effective name**, not the opaque id — so a URL copied
from the address bar is portable by construction. As before, the stamp uses
`replaceState` (vault identity never enters back/forward history, FEAT-0059) and
preserves the `#/…` note hash byte-for-byte.

**Session storage is unaffected.** Per-vault session state (recency,
expanded-folders, cached note list) stays keyed by the vault's opaque `id`
(FEAT-0059); only the *meaning of the `?ws` URL param* changes. Two vaults with
distinct effective names remain fully independent windows.

## Constraints

- **No new persistence mechanism.** The cached `workspace` name rides the existing
  `Vault` record in its idb-keyval key; the configured name rides the existing
  `.brulion.json` settings file (FEAT-0047). No new store, no new file.
- **Read `.brulion.json` only with permission.** The effective name used at
  startup resolution comes from the cached vault field, never a fresh disk read of
  a vault the window isn't attaching to — so resolution never needs a permission
  the window doesn't yet hold.
- **Moat: no note writes.** This phase reads `.brulion.json` (already the settings
  file) and writes the browser-private vault cache; it creates or modifies no
  `.md` file. Writing an explicit `workspace` name is P2's settings UI, not here.
- **Backward compatible.** A `?ws` that is an old opaque id must still resolve;
  this phase adds name resolution *in front of* the existing id lookup, it does not
  replace it.

## Out of scope

- **The settings UI to set an explicit `workspace` name** — the text field in the
  M16 settings modal is P2 (FEAT-0080). This phase reads the field if present and
  defaults to the folder name; it adds no way to edit it.
- **A "this link wanted workspace X" hint on the welcome screen** — when a
  permalink lands on a device without that folder, the plain welcome/pick flow
  runs (the hash is preserved). Telling the user *which* workspace the link wanted
  is a possible later nicety, not this phase.
- **Rename-stable note identity** — the note is addressed by path (FEAT-0036); a
  note rename/move still breaks the permalink. No hidden per-note id is introduced
  (it would collide with the opaque-frontmatter stance, FEAT-0042).

## Acceptance criteria

**AC-1** — A vault's effective name defaults to its folder name.
Given a vault whose `.brulion.json` has no `workspace` field (or an empty/blank
one),
When its effective name is resolved,
Then it equals the folder name (`handle.name`).

**AC-2** — An explicit `workspace` field overrides the folder name.
Given a vault whose `.brulion.json` sets `workspace` to a non-empty string `N`,
When its effective name is resolved,
Then it equals `N`, regardless of the folder's own name.

**AC-3** — Attaching a vault caches its configured workspace name.
Given a window attaches to a vault whose `.brulion.json` sets `workspace` to `N`,
When the attach completes,
Then the vault record persisted in IndexedDB carries `workspace = N` (available to
later startup resolution without re-reading the folder).

**AC-4** — `?ws=<name>` attaches to the vault with that effective name.
Given a granted vault whose effective name is `N`,
When a window loads with `?ws=N`,
Then the window attaches to that vault and opens it (no picker, no folder swap).

**AC-5** — A legacy opaque-id `?ws` still resolves.
Given a vault with opaque id `<id>` and no vault whose effective name equals
`<id>`,
When a window loads with `?ws=<id>`,
Then the window attaches to that vault (the pre-M38 id lookup is the fallback).

**AC-6** — A name collision resolves to the most-recently-used vault.
Given two granted vaults share the same effective name `N`,
When a window loads with `?ws=N`,
Then it attaches to the most-recently-used of them (the set is most-recent-first),
deterministically, without error.

**AC-7** — An unknown `?ws` falls back and preserves the note hash.
Given a window loads with `?ws=X#/some/note` where `X` matches no vault name and no
vault id,
When the restore runs,
Then it falls back to the most-recent vault (or the welcome screen if none), and
the `#/some/note` hash is left intact so the note resolves once a matching folder
is granted.

**AC-8** — The stamped `?ws` is the effective name, not the opaque id.
Given a window attaches to a vault whose effective name is `N`,
When `?ws` is stamped into the URL,
Then it is written as `?ws=N` (portable), using `replaceState` and preserving the
`#/…` note hash.

**AC-9** — Per-vault session state stays keyed by the opaque id.
Given two vaults with distinct effective names, each with its own recency and
expanded-folders state,
When the window attaches to one and then the other,
Then each shows its own session state — the change to `?ws`'s meaning does not mix
their per-vault storage (still keyed by the opaque id).

**AC-10** — No note bytes are written.
Given any of the above (resolve, attach, cache the name, stamp `?ws`),
When the vault cache and URL are updated,
Then no `.md` file is created or modified by this phase.
