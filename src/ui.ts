import { pickFolder } from "./fs"
import { saveFolder, loadFolder, hasPermission, requestAccess } from "./session"

/** Called once folder access is in hand (fresh pick or restored). */
export type OpenHandler = (dir: FileSystemDirectoryHandle) => Promise<void>

/**
 * Pick a folder, open it, and remember it. A dismissed picker is a no-op.
 * Errors are logged, never thrown (runs from a click handler).
 */
export async function openFolder(
  resumeButton: HTMLButtonElement,
  onOpen: OpenHandler,
): Promise<void> {
  try {
    const dir = await pickFolder()
    if (!dir) return // dismissed — leave everything as it was
    resumeButton.hidden = true // a fresh pick supersedes the resume-this-folder flow
    await onOpen(dir) // open first; persist only a folder we could use
    await saveFolder(dir)
  } catch (err) {
    console.error("Failed to open folder:", err)
  }
}

/**
 * On load, re-attach to the previously chosen folder: open it with zero clicks
 * when permission is still granted, else reveal the resume button.
 */
export async function restoreFolder(
  resumeButton: HTMLButtonElement,
  onOpen: OpenHandler,
): Promise<void> {
  try {
    const handle = await loadFolder()
    if (!handle) return
    if (await hasPermission(handle)) {
      await onOpen(handle)
      return
    }
    resumeButton.hidden = false
    resumeButton.addEventListener("click", () => {
      void resumeAccess(handle, resumeButton, onOpen)
    })
  } catch (err) {
    console.error("Failed to restore folder:", err)
  }
}

async function resumeAccess(
  handle: FileSystemDirectoryHandle,
  resumeButton: HTMLButtonElement,
  onOpen: OpenHandler,
): Promise<void> {
  try {
    if (!(await requestAccess(handle))) return // declined — keep the button for a retry
    resumeButton.hidden = true
    await onOpen(handle)
  } catch (err) {
    console.error("Failed to resume folder access:", err)
  }
}

/**
 * Render the folder's notes into `container` as a list of clickable rows. The
 * display name drops the `.md` extension (the file on disk keeps it); the active
 * note's row is marked. Clicking a row calls `onSelect` with the note's
 * filename. Rebuilds the container each call (re-render on open / switch).
 */
export function renderNoteList(
  container: HTMLElement,
  notes: string[],
  active: string,
  onSelect: (name: string) => void,
): void {
  container.replaceChildren()
  for (const name of notes) {
    const row = document.createElement("button")
    row.type = "button"
    row.className = "note-row"
    row.textContent = name.replace(/\.md$/i, "")
    if (name === active) {
      row.classList.add("active")
      row.setAttribute("aria-current", "true")
    }
    row.addEventListener("click", () => onSelect(name))
    container.append(row)
  }
}

/** Wire `button`'s click (the required user gesture) to {@link openFolder}. */
export function wireOpenFolder(
  button: HTMLButtonElement,
  resumeButton: HTMLButtonElement,
  onOpen: OpenHandler,
): void {
  button.addEventListener("click", () => {
    void openFolder(resumeButton, onOpen)
  })
}
