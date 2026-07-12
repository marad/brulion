import { get, set, del } from "idb-keyval"

/**
 * Per-reload session state. Folder handles now live in the vault set (M33/`vaults.ts`),
 * not here. State here is split: **content-tied** values (recency, expanded folders)
 * are keyed per vault id (FEAT-0059) so they don't bleed between vaults;
 * **window-ergonomics** values (sidebar collapse/width) and the active note stay
 * origin-global. Permission helpers (`readwrite`, matching FEAT-0002) round it out.
 */

const ACTIVE_KEY = "brulion:active"
const SIDEBAR_KEY = "brulion:sidebar-collapsed"
const SIDEBAR_WIDTH_KEY = "brulion:sidebar-width"
/** The pre-M33 global recency/expanded keys, migrated per-vault then cleared. */
const LEGACY_RECENCY_KEY = "brulion:recency"
const LEGACY_EXPANDED_KEY = "brulion:expanded-folders"
const recencyKey = (vaultId: string) => `brulion:recency:${vaultId}`
const expandedKey = (vaultId: string) => `brulion:expanded-folders:${vaultId}`
const noteListKey = (vaultId: string) => `brulion:note-list:${vaultId}`
const MODE = { mode: "readwrite" } as const

/** Remember which note was last active, so a reload returns to it. */
export function saveActiveNote(name: string): Promise<void> {
  return set(ACTIVE_KEY, name)
}

/** The last-active note's filename, or `undefined` if none was stored. */
export function loadActiveNote(): Promise<string | undefined> {
  return get<string>(ACTIVE_KEY)
}

/** Remember whether the note sidebar is collapsed (FEAT-0020). */
export function saveSidebarCollapsed(collapsed: boolean): Promise<void> {
  return set(SIDEBAR_KEY, collapsed)
}

/** Whether the sidebar was left collapsed; defaults to `false` (expanded). */
export async function loadSidebarCollapsed(): Promise<boolean> {
  return (await get<boolean>(SIDEBAR_KEY)) === true
}

/** Remember which folders the user expanded in `vaultId`'s tree (FEAT-0043/0059). */
export function saveExpandedFolders(
  vaultId: string,
  paths: ReadonlySet<string>,
): Promise<void> {
  return set(expandedKey(vaultId), [...paths])
}

/**
 * The set of expanded folder paths for `vaultId`; empty when none was stored — so by
 * default every folder renders collapsed (FEAT-0043). Absence means collapsed.
 */
export async function loadExpandedFolders(vaultId: string): Promise<Set<string>> {
  return new Set((await get<string[]>(expandedKey(vaultId))) ?? [])
}

/** Remember the user's chosen sidebar width in pixels (FEAT-0044). */
export function saveSidebarWidth(px: number): Promise<void> {
  return set(SIDEBAR_WIDTH_KEY, px)
}

/**
 * The stored sidebar width in pixels, or `null` when none was stored (or the
 * stored value is not a finite number) — in which case the sidebar uses its
 * default CSS basis (FEAT-0044).
 */
export async function loadSidebarWidth(): Promise<number | null> {
  const px = await get<number>(SIDEBAR_WIDTH_KEY)
  return typeof px === "number" && Number.isFinite(px) ? px : null
}

/** Persist `vaultId`'s most-recently-visited note list, most-recent first (FEAT-0039/0059). */
export function saveRecency(vaultId: string, paths: readonly string[]): Promise<void> {
  return set(recencyKey(vaultId), [...paths])
}

/** `vaultId`'s persisted MRU note list; an empty array when none was stored. */
export async function loadRecency(vaultId: string): Promise<string[]> {
  return (await get<string[]>(recencyKey(vaultId))) ?? []
}

/**
 * Persist `vaultId`'s last-known complete note list, so a returning vault can paint
 * a plausible sidebar immediately on attach instead of an empty (or stale, previous
 * vault's) one while the real listing is still in flight. A paint hint only — never
 * treated as authoritative; the real listing (partial or complete) always supersedes
 * it once it lands.
 */
export function saveNoteList(vaultId: string, notes: readonly string[]): Promise<void> {
  return set(noteListKey(vaultId), [...notes])
}

/** `vaultId`'s cached note list, or `[]` when none was stored (never opened before). */
export async function loadNoteList(vaultId: string): Promise<string[]> {
  return (await get<string[]>(noteListKey(vaultId))) ?? []
}

/**
 * Migrate the pre-M33 *global* recency/expanded values onto `vaultId` (FEAT-0059):
 * copy each legacy key to the per-vault key only when the per-vault value is absent
 * (don't clobber), then clear the legacy keys. Idempotent — a second call finds the
 * legacy keys gone and does nothing.
 */
export async function migrateLegacySession(vaultId: string): Promise<void> {
  const legacyRecency = await get<string[]>(LEGACY_RECENCY_KEY)
  if (legacyRecency && (await get(recencyKey(vaultId))) === undefined) {
    await set(recencyKey(vaultId), legacyRecency)
  }
  const legacyExpanded = await get<string[]>(LEGACY_EXPANDED_KEY)
  if (legacyExpanded && (await get(expandedKey(vaultId))) === undefined) {
    await set(expandedKey(vaultId), legacyExpanded)
  }
  await del(LEGACY_RECENCY_KEY)
  await del(LEGACY_EXPANDED_KEY)
}

/** Whether the handle already has readwrite permission (no prompt — silent). */
export async function hasPermission(
  handle: FileSystemDirectoryHandle,
): Promise<boolean> {
  return (await handle.queryPermission(MODE)) === "granted"
}

/**
 * Ask for readwrite permission. Must be called from a user gesture — the FSA
 * API rejects a prompt otherwise. Returns whether it was granted.
 */
export async function requestAccess(
  handle: FileSystemDirectoryHandle,
): Promise<boolean> {
  return (await handle.requestPermission(MODE)) === "granted"
}
