import { get, set } from "idb-keyval"

/**
 * The chosen folder's lifetime across reloads: persist its handle and check /
 * (re-)acquire permission. Permission is always `readwrite`, matching the pick
 * in FEAT-0002, so one grant covers the writes coming later.
 */

const DIR_KEY = "brulion:dir"
const ACTIVE_KEY = "brulion:active"
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
