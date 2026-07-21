import { get, del, update } from "idb-keyval"

/**
 * The set of granted folders ("vaults") the user works in (M33/FEAT-0059). Replaces
 * the single origin-global directory handle (FEAT-0003) with a persisted list, so a
 * window can re-attach to a *specific* vault by id (the `?ws=` URL param) and the
 * user can switch between previously-granted folders without the native picker.
 *
 * A vault's `id` is a short opaque generated key — stable for the vault's life and
 * independent of the folder name (names collide and change). `name` is the folder
 * name, for display only. The list is kept **most-recent-first**.
 *
 * Stored under one idb-keyval key as a `Vault[]`; the `handle`s are structured-
 * cloneable and persist in IndexedDB across reloads. No note bytes are touched.
 */
export interface Vault {
  /** Short opaque generated id; the per-vault session key, and the legacy `?ws=` value. */
  id: string
  /** The granted directory handle. */
  handle: FileSystemDirectoryHandle
  /** The folder's name, for display only. */
  name: string
  /** Cached configured workspace name from the vault's `.brulion.json` (FEAT-0079),
   * refreshed on every attach; absent when unset. Lets startup resolution match a
   * name-keyed `?ws=` without a disk read or a permission the window may not yet hold. */
  workspace?: string
}

const VAULTS_KEY = "brulion:vaults"
/** The pre-M33 single-handle key (FEAT-0003), migrated into the set then cleared. */
const LEGACY_DIR_KEY = "brulion:dir"

/** The persisted vaults, most-recent-first (empty when none stored). */
export async function listVaults(): Promise<Vault[]> {
  return (await get<Vault[]>(VAULTS_KEY)) ?? []
}

/** The vault with `id`, or `undefined` if not in the set. */
export async function getVault(id: string): Promise<Vault | undefined> {
  return (await listVaults()).find((v) => v.id === id)
}

/**
 * A vault's *effective name* (FEAT-0079): the trimmed configured `workspace` name
 * when non-empty, else the folder name. This is the value a portable `?ws=` carries
 * and matches against — defaulting to the folder name so the common case (one folder
 * named the same on every device) is portable with no configuration. Pure.
 */
export function effectiveVaultName(vault: Pick<Vault, "name" | "workspace">): string {
  const configured = vault.workspace?.trim()
  return configured ? configured : vault.name
}

/**
 * Resolve a `?ws=` reference (FEAT-0079), name-first then id-fallback: the vault
 * whose effective name equals `ref` (a collision resolves to the most-recently-used,
 * since the set is most-recent-first), else the vault whose opaque `id` equals `ref`
 * (the pre-M38 meaning, so existing links keep working), else `undefined`.
 *
 * Best-effort by design: it matches the *cached* effective name (see {@link Vault}),
 * so the folder-name default is always warm (stored at add time) but an explicit
 * `workspace` name set on another device resolves here only after this device has
 * attached to that vault at least once and refreshed its cache.
 */
export async function resolveVaultRef(ref: string): Promise<Vault | undefined> {
  const vaults = await listVaults() // most-recent-first
  // Name match wins; the first hit is the most-recent among any collisions.
  const byName = vaults.find((v) => effectiveVaultName(v) === ref)
  if (byName) return byName
  return vaults.find((v) => v.id === ref) // legacy opaque-id fallback
}

/**
 * The vault a window should open on load (FEAT-0079), given its `?ws=` value (or
 * `null`/empty when absent). An **explicit** `?ws` resolves to *its* vault via
 * {@link resolveVaultRef} or to nothing — it is never replaced by a different vault
 * (that would consume the note hash against the wrong folder and rewrite the shared
 * permalink; the caller shows the welcome/pick flow with the URL intact instead). An
 * **absent** `?ws` falls back to the most-recently-used vault (the set is
 * most-recent-first), else `undefined`.
 */
export async function pickStartupVault(ws: string | null): Promise<Vault | undefined> {
  if (ws) return resolveVaultRef(ws)
  return (await listVaults())[0]
}

/**
 * The `?ws=` value to write on a **failed** attach (FEAT-0079), or `null` to *clear*
 * `?ws`. Re-asserts the previously-attached vault's ref (`prevWs`) when there was a
 * prior vault (`prevVaultId` truthy) — a failed switch returns the window to it — else
 * returns `null` so a failed cold start clears the dead permalink and a reload
 * self-heals to the most-recently-used working vault instead of looping. Pure.
 */
export function wsToStampOnFailedAttach(
  prevVaultId: string,
  prevWs: string | null,
): string | null {
  return prevVaultId && prevWs ? prevWs : null
}

/** A new opaque id not already taken by an existing vault. */
function mintId(existing: readonly Vault[]): string {
  const taken = new Set(existing.map((v) => v.id))
  let id = crypto.randomUUID().slice(0, 8)
  while (taken.has(id)) id = crypto.randomUUID().slice(0, 8)
  return id
}

/** Move `vault` to the front of `list`, dropping any existing entry with its id. */
function toFront(vault: Vault, list: readonly Vault[]): Vault[] {
  return [vault, ...list.filter((x) => x.id !== vault.id)]
}

/**
 * Add `handle` as a vault and return it, moving it to the front (most-recent). If a
 * stored vault already refers to the same folder (`handle.isSameEntry`), that vault
 * is reused (moved to front) rather than duplicated — so re-picking a known folder
 * keeps its id. A fresh vault gets a newly generated opaque id.
 *
 * The persist runs through idb-keyval `update` (a single read-modify-write IDB
 * transaction) so two windows adding folders at once can't clobber each other's
 * write. `isSameEntry` is async and so must run before the transaction; the matched
 * vault is then re-resolved by id *inside* the updater against the live set, so a
 * concurrent change between the scan and the commit is still respected.
 */
export async function addVault(handle: FileSystemDirectoryHandle): Promise<Vault> {
  let matchId: string | null = null
  for (const v of await listVaults()) {
    try {
      if (await v.handle.isSameEntry(handle)) {
        matchId = v.id
        break
      }
    } catch {
      // a stale/invalidated stored handle can't match — skip it, don't abort the add
    }
  }
  let result!: Vault
  await update<Vault[]>(VAULTS_KEY, (current = []) => {
    const matched = matchId !== null ? current.find((x) => x.id === matchId) : undefined
    if (matched) {
      result = matched // re-pick of a known folder → reuse its id
      return toFront(matched, current)
    }
    // No match (or the matched vault vanished under us) → a fresh vault.
    result = { id: mintId(current), handle, name: handle.name }
    return [result, ...current]
  })
  return result
}

/**
 * Record that a window attached to the vault with `id`: move it to the front (so the
 * "most-recent vault" fallback for an absent `?ws` reflects real usage) **and**
 * refresh its cached workspace name (FEAT-0079) from the on-disk `.brulion.json`, in
 * a **single** read-modify-write transaction. `workspace` is stored trimmed, or the
 * field is cleared when blank/empty. A no-op if the id is absent. One transaction (not
 * a separate move-to-front + cache-write) keeps the attach path to a single serialize
 * of the vault set, and a concurrent window's write isn't clobbered. */
export async function markVaultAttached(id: string, workspace: string): Promise<void> {
  const name = workspace.trim() || undefined
  await update<Vault[]>(VAULTS_KEY, (current = []) => {
    const v = current.find((x) => x.id === id)
    return v ? toFront({ ...v, workspace: name }, current) : current
  })
}

/** Remove the vault with `id` from the set (forget it); a no-op if absent. Reserved
 * for the P2 "forget workspace" surface (FEAT-0060) — not yet wired in P1. A single
 * read-modify-write transaction (see {@link markVaultAttached}). */
export async function removeVault(id: string): Promise<void> {
  await update<Vault[]>(VAULTS_KEY, (current = []) => current.filter((v) => v.id !== id))
}

/**
 * One-time migration of the pre-M33 single handle: if the vault set is empty and the
 * legacy `brulion:dir` handle exists, add it as the first vault and clear the legacy
 * key, returning the new vault. Otherwise (already migrated, or nothing to migrate)
 * returns `undefined`. Idempotent.
 */
export async function migrateLegacyFolder(): Promise<Vault | undefined> {
  if ((await listVaults()).length > 0) return undefined
  const legacy = await get<FileSystemDirectoryHandle>(LEGACY_DIR_KEY)
  if (!legacy) return undefined
  const vault = await addVault(legacy)
  await del(LEGACY_DIR_KEY)
  return vault
}
