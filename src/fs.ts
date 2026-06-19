/**
 * File System Access helpers. The contract everything else builds on is "a
 * folder the user picked"; this module owns picking it and reading what's in it.
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
    if (err instanceof DOMException && err.name === "AbortError") return null
    throw err
  }
}

/**
 * List the names of the `.md` files directly in `dir` (case-insensitive on the
 * extension), sorted. Sub-directories and non-markdown files are ignored; the
 * folder is not traversed recursively.
 */
export async function listMarkdownFiles(
  dir: FileSystemDirectoryHandle,
): Promise<string[]> {
  const names: string[] = []
  for await (const entry of dir.values()) {
    if (entry.kind === "file" && entry.name.toLowerCase().endsWith(".md")) {
      names.push(entry.name)
    }
  }
  return names.sort((a, b) => a.localeCompare(b))
}
