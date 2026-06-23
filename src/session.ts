import { get, set } from "idb-keyval"

/**
 * The chosen folder's lifetime across reloads: persist its handle and check /
 * (re-)acquire permission. Permission is always `readwrite`, matching the pick
 * in FEAT-0002, so one grant covers the writes coming later.
 */

const DIR_KEY = "brulion:dir"
const ACTIVE_KEY = "brulion:active"
const SIDEBAR_KEY = "brulion:sidebar-collapsed"
const VIM_KEY = "brulion:vim"
const COLLAPSED_FOLDERS_KEY = "brulion:collapsed-folders"
const RECENCY_KEY = "brulion:recency"
const MODE = { mode: "readwrite" } as const

/** Persist the directory handle so it survives a reload. */
export function saveFolder(handle: FileSystemDirectoryHandle): Promise<void> {
  return set(DIR_KEY, handle)
}

/** The persisted directory handle, or `undefined` if none was stored. */
export function loadFolder(): Promise<FileSystemDirectoryHandle | undefined> {
  return get<FileSystemDirectoryHandle>(DIR_KEY)
}

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

/** Remember whether the opt-in Vim mode is enabled (FEAT-0021). */
export function saveVimMode(on: boolean): Promise<void> {
  return set(VIM_KEY, on)
}

/** Whether Vim mode was left on; defaults to `false` (off — opt-in). */
export async function loadVimMode(): Promise<boolean> {
  return (await get<boolean>(VIM_KEY)) === true
}

/** Remember which folders are collapsed in the tree (FEAT-0024), as an array. */
export function saveCollapsedFolders(paths: ReadonlySet<string>): Promise<void> {
  return set(COLLAPSED_FOLDERS_KEY, [...paths])
}

/** The set of collapsed folder paths; empty when none was stored. */
export async function loadCollapsedFolders(): Promise<Set<string>> {
  return new Set((await get<string[]>(COLLAPSED_FOLDERS_KEY)) ?? [])
}

/** Persist the most-recently-visited note list, most-recent first (FEAT-0039). */
export function saveRecency(paths: readonly string[]): Promise<void> {
  return set(RECENCY_KEY, [...paths])
}

/** The persisted MRU note list; an empty array when none was stored. */
export async function loadRecency(): Promise<string[]> {
  return (await get<string[]>(RECENCY_KEY)) ?? []
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
