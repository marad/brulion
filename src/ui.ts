import { pickFolder, listMarkdownFiles } from "./fs"
import { saveFolder, loadFolder, hasPermission, requestAccess } from "./session"

/** Called once folder access is in hand (fresh pick or restored). */
export type OpenHandler = (dir: FileSystemDirectoryHandle) => Promise<void>

/** Render `names` as the contents of `list`, replacing whatever was there. */
export function renderFileList(list: HTMLUListElement, names: string[]): void {
  list.replaceChildren(
    ...names.map((name) => {
      const item = document.createElement("li")
      item.textContent = name
      return item
    }),
  )
}

/** List a folder's markdown files, then hand the folder to `onOpen`. */
async function showFolder(
  handle: FileSystemDirectoryHandle,
  list: HTMLUListElement,
  onOpen: OpenHandler,
): Promise<void> {
  renderFileList(list, await listMarkdownFiles(handle))
  await onOpen(handle)
}

/**
 * Pick a folder, remember it, list it, and open its note. A dismissed picker is
 * a no-op. Errors are logged, never thrown (runs from a click handler).
 */
export async function openFolder(
  list: HTMLUListElement,
  resumeButton: HTMLButtonElement,
  onOpen: OpenHandler,
): Promise<void> {
  try {
    const dir = await pickFolder()
    if (!dir) return // dismissed — leave everything as it was
    resumeButton.hidden = true // a fresh pick supersedes the resume-this-folder flow
    await showFolder(dir, list, onOpen) // list + open; persist only a folder we could read
    await saveFolder(dir)
  } catch (err) {
    console.error("Failed to open folder:", err)
  }
}

/**
 * On load, re-attach to the previously chosen folder: list + open it with zero
 * clicks when permission is still granted, else reveal the resume button.
 */
export async function restoreFolder(
  list: HTMLUListElement,
  resumeButton: HTMLButtonElement,
  onOpen: OpenHandler,
): Promise<void> {
  try {
    const handle = await loadFolder()
    if (!handle) return
    if (await hasPermission(handle)) {
      await showFolder(handle, list, onOpen)
      return
    }
    resumeButton.hidden = false
    resumeButton.addEventListener("click", () => {
      void resumeAccess(handle, list, resumeButton, onOpen)
    })
  } catch (err) {
    console.error("Failed to restore folder:", err)
  }
}

async function resumeAccess(
  handle: FileSystemDirectoryHandle,
  list: HTMLUListElement,
  resumeButton: HTMLButtonElement,
  onOpen: OpenHandler,
): Promise<void> {
  try {
    if (!(await requestAccess(handle))) return // declined — keep the button for a retry
    resumeButton.hidden = true
    await showFolder(handle, list, onOpen)
  } catch (err) {
    console.error("Failed to resume folder access:", err)
  }
}

/** Wire `button`'s click (the required user gesture) to {@link openFolder}. */
export function wireOpenFolder(
  button: HTMLButtonElement,
  list: HTMLUListElement,
  resumeButton: HTMLButtonElement,
  onOpen: OpenHandler,
): void {
  button.addEventListener("click", () => {
    void openFolder(list, resumeButton, onOpen)
  })
}
