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

/** A note leaf in the folder tree: its display name (no `.md`) and full path. */
export interface NoteLeaf {
  kind: "note"
  name: string
  path: string
}

/** A folder node: its own segment name, full folder path, and ordered children. */
export interface FolderNode {
  kind: "folder"
  name: string
  path: string
  children: TreeNode[]
}

export type TreeNode = FolderNode | NoteLeaf

/**
 * Turn the sorted flat path list from `listNotes` into a nested tree (FEAT-0024):
 * a path with no `/` is a root note; folder segments contribute (interned) folder
 * nodes holding the note. Pure — the only place the listing becomes a tree — and
 * order-preserving: children appear in the order their paths arrive (already
 * case-insensitively sorted by full path). The tree is never stored; it is
 * rebuilt from the listing each render, so the disk stays the source of truth.
 */
export function buildNoteTree(paths: string[]): TreeNode[] {
  const root: TreeNode[] = []
  const folders = new Map<string, FolderNode>() // full folder path → node (interned)

  for (const path of paths) {
    const segments = path.split("/")
    let children = root
    let prefix = ""
    for (let i = 0; i < segments.length - 1; i++) {
      prefix = prefix ? `${prefix}/${segments[i]}` : segments[i]
      let folder = folders.get(prefix)
      if (!folder) {
        folder = { kind: "folder", name: segments[i], path: prefix, children: [] }
        folders.set(prefix, folder)
        children.push(folder)
      }
      children = folder.children
    }
    children.push({ kind: "note", name: displayName(segments[segments.length - 1]), path })
  }
  return root
}

/** Callbacks for the note list: open a note, delete a note, or toggle a folder. */
export interface NoteListHandlers {
  onSelect: (path: string) => void
  onDelete: (path: string) => void
  /** A folder's disclosure was clicked; `collapsed` is its new state. */
  onToggleFolder?: (path: string, collapsed: boolean) => void
}

/**
 * Render the folder tree into `container` (FEAT-0024). Notes render as rows (a
 * name button — display name drops `.md` — plus a delete button); folders render
 * as a header with a disclosure control over an indented children container.
 * `onSelect`/`onDelete` receive the note's **full path**. The active note's row
 * is marked wherever it sits. A folder renders collapsed when its path is in
 * `collapsed`, except that the active note's ancestors are always expanded so it
 * stays visible (the set is read, never mutated, here). Clicking a folder header
 * hides/shows its children in place and reports the new state via
 * `onToggleFolder`. Rebuilds the container each call.
 */
export function renderNoteList(
  container: HTMLElement,
  notes: string[],
  active: string,
  handlers: NoteListHandlers,
  collapsed: ReadonlySet<string> = new Set(),
): void {
  container.replaceChildren()
  for (const node of buildNoteTree(notes)) {
    container.append(renderNode(node, active, handlers, collapsed))
  }
}

/** Render one tree node (note row or folder subtree) to a detached element. */
function renderNode(
  node: TreeNode,
  active: string,
  handlers: NoteListHandlers,
  collapsed: ReadonlySet<string>,
): HTMLElement {
  if (node.kind === "note") return renderNoteRow(node, active, handlers)

  const folder = document.createElement("div")
  folder.className = "note-folder"

  // The active note's ancestors stay open so a freshly created/restored nested
  // note is never hidden; every other folder honors the persisted collapsed set.
  const isAncestorOfActive = active === node.path || active.startsWith(node.path + "/")
  const isCollapsed = collapsed.has(node.path) && !isAncestorOfActive

  const header = document.createElement("button")
  header.type = "button"
  header.className = "folder-header"
  header.textContent = node.name
  header.setAttribute("aria-expanded", String(!isCollapsed))

  const children = document.createElement("div")
  children.className = "folder-children"
  children.hidden = isCollapsed
  for (const child of node.children) {
    children.append(renderNode(child, active, handlers, collapsed))
  }

  header.addEventListener("click", () => {
    children.hidden = !children.hidden
    header.setAttribute("aria-expanded", String(!children.hidden))
    handlers.onToggleFolder?.(node.path, children.hidden)
  })

  folder.append(header, children)
  return folder
}

/** Render a single note row (name button + delete button). */
function renderNoteRow(node: NoteLeaf, active: string, handlers: NoteListHandlers): HTMLElement {
  const row = document.createElement("div")
  row.className = "note-row"
  if (node.path === active) {
    row.classList.add("active")
    row.setAttribute("aria-current", "true")
  }

  const nameButton = document.createElement("button")
  nameButton.type = "button"
  nameButton.className = "note-name"
  nameButton.textContent = node.name
  nameButton.addEventListener("click", () => handlers.onSelect(node.path))

  const deleteButton = document.createElement("button")
  deleteButton.type = "button"
  deleteButton.className = "note-delete"
  deleteButton.textContent = "×"
  deleteButton.title = `Delete ${node.name}`
  deleteButton.setAttribute("aria-label", `Delete ${node.name}`)
  deleteButton.addEventListener("click", () => handlers.onDelete(node.path))

  row.append(nameButton, deleteButton)
  return row
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
