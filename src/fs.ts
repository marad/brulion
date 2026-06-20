/**
 * File System Access helpers. The contract everything else builds on is "a
 * folder the user picked"; this module owns picking it.
 */

/**
 * Prompt the user to pick a folder. Must be called from a user gesture (a
 * click) — the File System Access API rejects otherwise. Requests `readwrite`
 * up front so later phases that save don't trigger a second permission prompt.
 * Returns the handle, or `null` if the user dismisses the picker.
 */
export async function pickFolder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await window.showDirectoryPicker({ mode: "readwrite" })
  } catch (err) {
    if (isAbortError(err)) return null
    throw err
  }
}

/**
 * True when `err` represents the user dismissing a picker. Matches on `name`
 * rather than `instanceof DOMException` so it also holds for polyfilled or
 * cross-realm rejections that are AbortError-shaped but not real DOMExceptions.
 */
function isAbortError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: unknown }).name === "AbortError"
  )
}
