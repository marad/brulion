import { get, set, del } from "idb-keyval"

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
  /** Short opaque generated id; the value carried in `?ws=` and the per-vault session key. */
  id: string
  /** The granted directory handle. */
  handle: FileSystemDirectoryHandle
  /** The folder's name, for display only. */
  name: string
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

/** A new opaque id not already taken by an existing vault. */
function mintId(existing: readonly Vault[]): string {
  const taken = new Set(existing.map((v) => v.id))
  let id = crypto.randomUUID().slice(0, 8)
  while (taken.has(id)) id = crypto.randomUUID().slice(0, 8)
  return id
}

/** Put `vault` at the front of `rest` (which must not contain it) and persist. */
function persistFront(vault: Vault, rest: readonly Vault[]): Promise<void> {
  return set(VAULTS_KEY, [vault, ...rest])
}

/**
 * Add `handle` as a vault and return it, moving it to the front (most-recent). If a
 * stored vault already refers to the same folder (`handle.isSameEntry`), that vault
 * is reused (moved to front) rather than duplicated — so re-picking a known folder
 * keeps its id. A fresh vault gets a newly generated opaque id.
 */
export async function addVault(handle: FileSystemDirectoryHandle): Promise<Vault> {
  const vaults = await listVaults()
  for (const v of vaults) {
    let same = false
    try {
      same = await v.handle.isSameEntry(handle)
    } catch {
      same = false // a stale/invalidated stored handle can't match — skip it, don't abort the add
    }
    if (same) {
      await persistFront(v, vaults.filter((x) => x.id !== v.id))
      return v
    }
  }
  const vault: Vault = { id: mintId(vaults), handle, name: handle.name }
  await persistFront(vault, vaults)
  return vault
}

/** Move the vault with `id` to the front (most-recent); a no-op if absent. Used on
 * attach so the "most-recent vault" fallback (no `?ws`) reflects real usage. */
export async function touchVault(id: string): Promise<void> {
  const vaults = await listVaults()
  const v = vaults.find((x) => x.id === id)
  if (!v) return
  await persistFront(v, vaults.filter((x) => x.id !== id))
}

/** Remove the vault with `id` from the set (forget it); a no-op if absent. Reserved
 * for the P2 "forget workspace" surface (FEAT-0060) — not yet wired in P1. */
export async function removeVault(id: string): Promise<void> {
  const vaults = await listVaults()
  if (!vaults.some((v) => v.id === id)) return
  await set(VAULTS_KEY, vaults.filter((v) => v.id !== id))
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
