import { pickFolder } from "./fs"
import { saveFolder, loadFolder, hasPermission, requestAccess } from "./session"
import { displayName } from "./note-name"

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

/** Callbacks for a note row: open it, or delete it. */
export interface NoteListHandlers {
  onSelect: (name: string) => void
  onDelete: (name: string) => void
}

/**
 * Render the folder's notes into `container`, one row each. A row has a name
 * button (display name drops the `.md` extension; the file keeps it) and a
 * delete button. The active note's row is marked. Clicking the name calls
 * `onSelect`; clicking the delete button calls `onDelete` (with the filename).
 * Rebuilds the container each call (re-render on open / switch / mutate).
 */
export function renderNoteList(
  container: HTMLElement,
  notes: string[],
  active: string,
  handlers: NoteListHandlers,
): void {
  container.replaceChildren()
  for (const name of notes) {
    const row = document.createElement("div")
    row.className = "note-row"
    if (name === active) {
      row.classList.add("active")
      row.setAttribute("aria-current", "true")
    }

    const nameButton = document.createElement("button")
    nameButton.type = "button"
    nameButton.className = "note-name"
    nameButton.textContent = displayName(name)
    nameButton.addEventListener("click", () => handlers.onSelect(name))

    const deleteButton = document.createElement("button")
    deleteButton.type = "button"
    deleteButton.className = "note-delete"
    deleteButton.textContent = "×"
    deleteButton.title = `Delete ${nameButton.textContent}`
    deleteButton.setAttribute("aria-label", `Delete ${nameButton.textContent}`)
    deleteButton.addEventListener("click", () => handlers.onDelete(name))

    row.append(nameButton, deleteButton)
    container.append(row)
  }
}

/**
 * Wire a new-note form: on submit, pass the trimmed input value to `onCreate`
 * and clear the field. An empty/whitespace-only value is ignored. The caller
 * surfaces any creation error (invalid name, duplicate) itself.
 */
export function wireNewNote(
  form: HTMLFormElement,
  input: HTMLInputElement,
  onCreate: (name: string) => void,
): void {
  form.addEventListener("submit", (event) => {
    event.preventDefault()
    const value = input.value.trim()
    if (!value) return
    input.value = ""
    onCreate(value)
  })
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

/** A handle on a toggle's state, so a keyboard shortcut can flip it too. */
export interface Toggle {
  /** Flip the state: re-`apply` it, update `aria-pressed`, and notify `onChange`. */
  toggle(): void
}

/**
 * Wire a two-state toggle button (FEAT-0020 sidebar, FEAT-0021 Vim). `apply(on)`
 * effects the state in the UI/editor and runs on wire *and* on every flip, so the
 * page loads in the mode the user left it; `onChange(on)` persists and runs only
 * on a user flip. The pressed state is mirrored in `aria-pressed`. Returns a
 * handle so a keyboard shortcut can drive the same flip as a click.
 */
export function wireToggle(
  button: HTMLButtonElement,
  opts: {
    initialOn: boolean
    apply: (on: boolean) => void
    onChange: (on: boolean) => void
  },
): Toggle {
  let on = opts.initialOn
  const render = () => {
    opts.apply(on)
    button.setAttribute("aria-pressed", String(on))
  }
  const toggle = () => {
    on = !on
    render()
    opts.onChange(on)
  }
  render() // reflect the restored state before any interaction
  button.addEventListener("click", toggle)
  return { toggle }
}
