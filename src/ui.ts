import { pickFolder } from "./fs"
import { saveFolder, loadFolder, hasPermission, requestAccess } from "./session"
import { displayName } from "./note-name"
import type { AddNoteResult } from "./note-controller"

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
 * is marked wherever it sits. A folder renders **collapsed by default** (FEAT-0043)
 * and is expanded only when its path is in `expanded` or it is an ancestor of the
 * active note (which is always expanded so the open note stays visible). The set
 * is read, never mutated, here. Clicking a folder header hides/shows its children
 * in place and reports the new collapsed state via `onToggleFolder`. Rebuilds the
 * container each call.
 */
export function renderNoteList(
  container: HTMLElement,
  notes: string[],
  active: string,
  handlers: NoteListHandlers,
  expanded: ReadonlySet<string> = new Set(),
): void {
  container.replaceChildren()
  for (const node of buildNoteTree(notes)) {
    container.append(renderNode(node, active, handlers, expanded))
  }
}

/** Render one tree node (note row or folder subtree) to a detached element. */
function renderNode(
  node: TreeNode,
  active: string,
  handlers: NoteListHandlers,
  expanded: ReadonlySet<string>,
): HTMLElement {
  if (node.kind === "note") return renderNoteRow(node, active, handlers)

  const folder = document.createElement("div")
  folder.className = "note-folder"

  // Collapsed by default (FEAT-0043): a folder opens only when the user expanded
  // it, or when it is an ancestor of the active note — that rule always wins so a
  // freshly created/restored nested note is never hidden behind a collapsed folder.
  const isAncestorOfActive = active === node.path || active.startsWith(node.path + "/")
  const isCollapsed = !expanded.has(node.path) && !isAncestorOfActive

  const header = document.createElement("button")
  header.type = "button"
  header.className = "folder-header"
  header.textContent = node.name
  header.title = node.path // full folder path on hover (the row may be truncated)
  header.setAttribute("aria-expanded", String(!isCollapsed))

  const children = document.createElement("div")
  children.className = "folder-children"
  children.hidden = isCollapsed
  for (const child of node.children) {
    children.append(renderNode(child, active, handlers, expanded))
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
  nameButton.title = displayName(node.path) // full note path on hover (rows ellipsize)
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

/** A handle on the header note-identity widget so the app can keep it pointed
 * at the open note as the active note changes (FEAT-0035). */
export interface NoteIdentityHandle {
  /** Point the display at `activePath` (a folder-relative `.md` path). */
  update(activePath: string): void
}

/**
 * Mount the header's open-note identity into `container` (FEAT-0035): a display
 * showing the open note's folder path (muted) and name (no `.md`), which on click
 * becomes an inline editor to rename the note in place. Enter commits via
 * `onRename` (the controller's `renameActive`); Esc or blur cancels. A rejected
 * rename keeps the editor open, preserves the typed text, and surfaces the
 * reason; a successful one returns to the display, which the app then repoints
 * via {@link NoteIdentityHandle.update} from the controller's announce.
 */
export function mountNoteIdentity(
  container: HTMLElement,
  onRename: (name: string) => Promise<AddNoteResult>,
): NoteIdentityHandle {
  let path = ""
  let editing = false
  // True for the whole span of an in-flight commit: blocks a second Enter from
  // firing a duplicate rename, and suppresses the blur-cancel that the
  // programmatic focus move (on a successful commit) would otherwise trigger.
  let committing = false

  const display = document.createElement("button")
  display.type = "button"
  display.className = "note-identity-display"

  const input = document.createElement("input")
  input.type = "text"
  input.className = "note-identity-edit"
  input.setAttribute("aria-label", "Rename note")
  input.autocomplete = "off"
  input.hidden = true

  const error = document.createElement("span")
  error.className = "note-identity-error"
  error.hidden = true

  // Render the display as a muted folder prefix + the emphasized name. A
  // root-level note has no prefix; a nested one shows `folder/.../` then the name.
  const renderDisplay = () => {
    const full = displayName(path) // strip `.md`
    const slash = full.lastIndexOf("/")
    const prefix = slash === -1 ? "" : full.slice(0, slash + 1)
    const name = slash === -1 ? full : full.slice(slash + 1)
    display.replaceChildren()
    if (prefix) {
      const folder = document.createElement("span")
      folder.className = "note-identity-path"
      folder.textContent = prefix
      display.append(folder)
    }
    const leaf = document.createElement("span")
    leaf.className = "note-identity-name"
    leaf.textContent = name
    display.append(leaf)
    display.title = `${full} — click to rename`
  }

  const showDisplay = () => {
    editing = false
    input.hidden = true
    error.hidden = true
    display.hidden = false
  }

  const startEditing = () => {
    if (!path) return
    editing = true
    error.hidden = true
    display.hidden = true
    input.hidden = false
    input.value = displayName(path) // full path without `.md`
    input.focus()
    input.select()
  }

  // Keep editing with the typed text intact and surface why the rename did not
  // happen. Used for both a refusal (`renameActive` returned a reason) and an
  // unexpected throw — the latter so a platform that lacks an API the rename
  // relies on (e.g. `FileSystemFileHandle.move`) shows the message inline instead
  // of leaving the editor silently stuck (no console on a mobile PWA).
  const showError = (message: string) => {
    error.textContent = message
    error.hidden = false
    input.focus()
  }

  const commit = async () => {
    if (committing) return // a rename is already in flight — ignore a second Enter
    committing = true
    try {
      const result = await onRename(input.value)
      if (result.ok) {
        showDisplay() // the controller's announce will repoint via update()
      } else {
        showError(result.reason)
      }
    } catch (err) {
      showError(err instanceof Error ? `${err.name}: ${err.message}` : String(err))
    } finally {
      committing = false
    }
  }

  display.addEventListener("click", startEditing)
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault()
      void commit()
    } else if (event.key === "Escape") {
      event.preventDefault()
      showDisplay()
    }
  })
  // Losing focus commits, like Finder / VS Code's rename and unlike a desktop-only
  // cancel: on touch, tapping away is the natural "done" gesture (and the soft
  // keyboard's Go button blurs rather than sending a clean Enter). Esc and a
  // successful commit both close via showDisplay(), which clears `editing` first,
  // so this only fires on a genuine focus-away — not on our own programmatic
  // hide. `committing` keeps a concurrent commit from re-entering.
  input.addEventListener("blur", () => {
    if (editing && !committing) void commit()
  })

  container.append(display, input, error)

  return {
    update(activePath) {
      path = activePath
      renderDisplay()
      // Don't yank the field out from under the user mid-edit; the display will
      // be correct the next time it is shown.
      if (!editing) showDisplay()
    },
  }
}

/** The elements that flip between the pre-folder welcome state and the workspace. */
export interface WorkspaceRefs {
  welcome: HTMLElement
  sidebar: HTMLElement
  toggleSidebar: HTMLElement
  toggleVim: HTMLElement
  reopen: HTMLElement
  identity: HTMLElement
  resizer: HTMLElement
}

/**
 * Swap from the first-run welcome hero to the working view (FEAT-0031): hide the
 * hero and reveal the in-note header controls + the sidebar. The single place the
 * pre-folder → folder-open visibility flip happens; the inverse is the initial
 * HTML state. The Install button is governed separately (FEAT-0030), so it is not
 * touched here.
 */
export function showWorkspace(refs: WorkspaceRefs): void {
  refs.welcome.hidden = true
  refs.sidebar.hidden = false
  refs.toggleSidebar.hidden = false
  refs.toggleVim.hidden = false
  refs.reopen.hidden = false
  refs.identity.hidden = false
  refs.resizer.hidden = false // the sidebar is on screen now, so the resize handle applies (FEAT-0044)
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

/** The sidebar's minimum resizable width in pixels (FEAT-0044). */
export const SIDEBAR_MIN_PX = 144

/**
 * Floor a desired sidebar width at `SIDEBAR_MIN_PX` (FEAT-0044): never so narrow
 * it's unusable (or invisible-but-present). A non-finite value (a corrupt stored
 * width) also floors to the minimum. There is no upper bound — the editor's CSS
 * `min-width` caps how wide the sidebar can *render*, a cap that scales with the
 * window rather than an arbitrary pixel limit. Pure.
 */
export function clampSidebarWidth(px: number): number {
  if (!Number.isFinite(px)) return SIDEBAR_MIN_PX
  return Math.max(SIDEBAR_MIN_PX, px)
}

/**
 * Wire the sidebar/editor border handle so dragging it resizes the sidebar
 * (FEAT-0044). The width is driven through the `--sidebar-width` custom property
 * the sidebar's `flex-basis` reads; `initialWidth` (a restored width, or `null`
 * for the CSS default) is applied on wire through {@link clampSidebarWidth}, and
 * `onChange` fires once on drag end with the final clamped width to persist.
 *
 * The drag is delta-based (final = start width + pointer delta), so it's
 * independent of the sidebar's left offset; pointer capture keeps it tracking if
 * the pointer leaves the thin handle, and text selection is suppressed while
 * dragging. The drag ends on `lostpointercapture` — fired by both a normal
 * release and an interruption (pointercancel, an OS gesture) — so cleanup always
 * runs and the *last applied* width (what the user sees) is what gets persisted.
 */
export function wireSidebarResize(
  handle: HTMLElement,
  sidebar: HTMLElement,
  opts: { initialWidth: number | null; onChange: (px: number) => void },
): void {
  const setWidth = (px: number) => sidebar.style.setProperty("--sidebar-width", `${px}px`)
  if (opts.initialWidth !== null) setWidth(clampSidebarWidth(opts.initialWidth))

  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault() // don't start a text selection / focus shift
    const startX = event.clientX
    const startWidth = sidebar.getBoundingClientRect().width
    let width = startWidth
    handle.setPointerCapture(event.pointerId)
    document.body.style.userSelect = "none" // no text selection mid-drag

    const onMove = (ev: PointerEvent) => {
      width = clampSidebarWidth(startWidth + ev.clientX - startX)
      setWidth(width)
    }
    const onEnd = () => {
      handle.removeEventListener("pointermove", onMove)
      handle.removeEventListener("lostpointercapture", onEnd)
      document.body.style.userSelect = ""
      opts.onChange(width)
    }
    handle.addEventListener("pointermove", onMove)
    handle.addEventListener("lostpointercapture", onEnd)
  })
}

/** Controls the missing-note banner (FEAT-0036): show it naming a note, or hide it. */
export interface MissingNoteBannerHandle {
  /** Reveal the banner announcing that `name` (a display path, no `.md`) is missing. */
  show(name: string): void
  /** Hide the banner. */
  hide(): void
}

/**
 * Mount the non-blocking "this note doesn't exist" banner (FEAT-0036). When a URL
 * hash names a note absent from the folder, the banner names it and offers to
 * create it — instead of the address bar silently disagreeing with the open note.
 * `onCreate` fires on the Create button (the caller makes the note via the normal
 * create path); `onDismiss` fires on the × (the caller re-syncs the URL to the
 * open note). Pure DOM glue; the caller owns both the create and the URL re-sync.
 */
export function mountMissingNoteBanner(
  container: HTMLElement,
  handlers: { onCreate: () => void; onDismiss: () => void },
): MissingNoteBannerHandle {
  const banner = document.createElement("div")
  banner.className = "missing-note-banner"
  banner.setAttribute("role", "status")
  banner.hidden = true

  const message = document.createElement("span")
  message.className = "missing-note-message"

  const create = document.createElement("button")
  create.type = "button"
  create.className = "missing-note-create"
  create.textContent = "Create"

  const dismiss = document.createElement("button")
  dismiss.type = "button"
  dismiss.className = "missing-note-dismiss"
  dismiss.setAttribute("aria-label", "Dismiss")
  dismiss.textContent = "×"

  create.addEventListener("click", () => handlers.onCreate())
  dismiss.addEventListener("click", () => handlers.onDismiss())

  banner.append(message, create, dismiss)
  container.append(banner)

  return {
    show(name) {
      message.textContent = `"${name}" doesn't exist yet.`
      banner.hidden = false
    },
    hide() {
      banner.hidden = true
    },
  }
}
