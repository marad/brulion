import { pickFolder, listMarkdownFiles } from "./fs"
import { saveFolder, loadFolder, hasPermission, requestAccess } from "./session"

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

/** List a folder's markdown files into `list`. */
export async function showFolder(
  handle: FileSystemDirectoryHandle,
  list: HTMLUListElement,
): Promise<void> {
  renderFileList(list, await listMarkdownFiles(handle))
}

/**
 * Pick a folder, remember it, and show its markdown files. A dismissed picker
 * is a no-op. Errors are logged, never thrown (runs from a fire-and-forget
 * click handler).
 */
export async function openFolder(
  list: HTMLUListElement,
  resumeButton: HTMLButtonElement,
): Promise<void> {
  try {
    const dir = await pickFolder()
    if (!dir) return // dismissed — leave everything as it was
    resumeButton.hidden = true // a fresh pick supersedes the resume-this-folder flow
    await showFolder(dir, list) // list first; persist only a folder we could read
    await saveFolder(dir)
  } catch (err) {
    console.error("Failed to open folder:", err)
  }
}

/**
 * On load, re-attach to the previously chosen folder. If its permission is
 * still granted, list its files with zero clicks; otherwise reveal the resume
 * button, whose click re-requests permission (a user gesture). With nothing
 * persisted, do nothing — the plain pick-a-folder state stands.
 */
export async function restoreFolder(
  list: HTMLUListElement,
  resumeButton: HTMLButtonElement,
): Promise<void> {
  try {
    const handle = await loadFolder()
    if (!handle) return
    if (await hasPermission(handle)) {
      await showFolder(handle, list)
      return
    }
    resumeButton.hidden = false
    resumeButton.addEventListener("click", () => {
      void resumeAccess(handle, list, resumeButton)
    })
  } catch (err) {
    console.error("Failed to restore folder:", err)
  }
}

async function resumeAccess(
  handle: FileSystemDirectoryHandle,
  list: HTMLUListElement,
  resumeButton: HTMLButtonElement,
): Promise<void> {
  try {
    if (!(await requestAccess(handle))) return // declined — keep the button for a retry
    resumeButton.hidden = true
    await showFolder(handle, list)
  } catch (err) {
    console.error("Failed to resume folder access:", err)
  }
}

/** Wire `button`'s click (the required user gesture) to {@link openFolder}. */
export function wireOpenFolder(
  button: HTMLButtonElement,
  list: HTMLUListElement,
  resumeButton: HTMLButtonElement,
): void {
  button.addEventListener("click", () => {
    void openFolder(list, resumeButton)
  })
}
