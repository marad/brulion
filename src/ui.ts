import { createElement } from "lucide"
import { pickFolder } from "./fs"
import { hasPermission, requestAccess } from "./session"
import { displayName } from "./note-name"
import { openTreeMenu, type TreeMenuItem } from "./tree-menu"
import { wireLongPress } from "./long-press"
import { isWithin, type AddNoteResult } from "./note-controller"
import type { Action } from "./actions"
import type { Vault } from "./vaults"

/** Called with a freshly-picked folder handle; the host records it as a vault and
 * attaches the window to it (M33/FEAT-0059). */
export type OpenHandler = (dir: FileSystemDirectoryHandle) => Promise<void>
/** Called to attach the window to a known vault (after permission is in hand). */
export type AttachHandler = (vault: Vault) => Promise<void>

/**
 * Pick a folder and hand it to the host (which records it as a vault and attaches).
 * A dismissed picker is a no-op. Errors are logged, never thrown (runs from a click).
 */
export async function openFolder(
  resumeButton: HTMLButtonElement,
  onOpen: OpenHandler,
): Promise<void> {
  try {
    const dir = await pickFolder()
    if (!dir) return // dismissed — leave everything as it was
    resumeButton.hidden = true // a fresh pick supersedes the resume-this-folder flow
    await onOpen(dir)
  } catch (err) {
    console.error("Failed to open folder:", err)
  }
}

/**
 * Re-attach the window to a specific vault (M33/FEAT-0059): attach with zero clicks
 * when its handle still has permission, else reveal the resume button which re-grants
 * (a user gesture) and then attaches. Replaces the old single-folder `restoreFolder`.
 */
export async function restoreVault(
  vault: Vault,
  resumeButton: HTMLButtonElement,
  onAttach: AttachHandler,
): Promise<void> {
  try {
    if (await hasPermission(vault.handle)) {
      await onAttach(vault)
      return
    }
    resumeButton.hidden = false
    // Assign `onclick` (not addEventListener): restoreVault can run more than once
    // against the same shared button (e.g. a re-resolve / vault switch), and
    // stacking listeners would fire resumeAccess — hence requestAccess — multiple
    // times on a single click. Assignment replaces any prior handler; a declined
    // attempt keeps the button and its (single) handler for a retry.
    resumeButton.onclick = () => {
      void resumeAccess(vault, resumeButton, onAttach)
    }
  } catch (err) {
    console.error("Failed to restore vault:", err)
  }
}

async function resumeAccess(
  vault: Vault,
  resumeButton: HTMLButtonElement,
  onAttach: AttachHandler,
): Promise<void> {
  try {
    if (!(await requestAccess(vault.handle))) return // declined — keep the button for a retry
    resumeButton.hidden = true
    await onAttach(vault)
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
 * nodes holding the note. `folders` (M35/FEAT-0069) additionally materializes
 * folders that hold no notes at all — a note path only ever implies the folders
 * on its way to a leaf, so an empty one needs its own explicit entry. Pure — the
 * only place the listing becomes a tree — and order-preserving: **neither list is
 * ever reordered relative to itself** (the caller owns that), they are only
 * merged — walked with two pointers, taking whichever of the two current heads
 * compares first — so an empty folder still interleaves sensibly among populated
 * siblings instead of only ever trailing after them, without second-guessing the
 * order either list was given in. The tree is never stored; it is rebuilt from
 * the listing each render, so the disk stays the source of truth.
 */
export function buildNoteTree(paths: string[], folders: string[] = []): TreeNode[] {
  const root: TreeNode[] = []
  const folderNodes = new Map<string, FolderNode>() // full folder path → node (interned)

  // Materialize (or find) the chain of folder nodes for `segments`, creating any
  // missing ones along the way, and return the innermost folder's children array.
  const ensureChain = (segments: string[]): TreeNode[] => {
    let children = root
    let prefix = ""
    for (const segment of segments) {
      prefix = prefix ? `${prefix}/${segment}` : segment
      let folder = folderNodes.get(prefix)
      if (!folder) {
        folder = { kind: "folder", name: segment, path: prefix, children: [] }
        folderNodes.set(prefix, folder)
        children.push(folder)
      }
      children = folder.children
    }
    return children
  }

  const insertNote = (path: string): void => {
    const segments = path.split("/")
    const children = ensureChain(segments.slice(0, -1))
    children.push({ kind: "note", name: displayName(segments[segments.length - 1]), path })
  }
  const insertFolder = (path: string): void => {
    ensureChain(path.split("/")) // a bare folder — materializes the chain, no leaf
  }

  let i = 0
  let j = 0
  while (i < paths.length && j < folders.length) {
    if (paths[i].localeCompare(folders[j], undefined, { sensitivity: "base" }) <= 0) {
      insertNote(paths[i++])
    } else {
      insertFolder(folders[j++])
    }
  }
  while (i < paths.length) insertNote(paths[i++])
  while (j < folders.length) insertFolder(folders[j++])

  return root
}

/** Callbacks for the note list: open a note, delete a note, or toggle a folder. */
export interface NoteListHandlers {
  onSelect: (path: string) => void
  onDelete: (path: string) => void
  /** A folder's disclosure was clicked; `collapsed` is its new state. */
  onToggleFolder?: (path: string, collapsed: boolean) => void
  /** The folder row's "+" was clicked (M35/FEAT-0069); `path` is that folder's
   * own path, the new subfolder's intended parent. */
  onCreateFolder?: (path: string) => void
  /** The folder row's "×" was clicked (M35/FEAT-0069); `path` is the folder to
   * delete, along with everything beneath it. */
  onDeleteFolder?: (path: string) => void
  /** A note row's move control was clicked (M35/FEAT-0070); `path` is that
   * note's own path. */
  onMoveNote?: (path: string) => void
  /** A folder row's move control was clicked (M35/FEAT-0070); `path` is that
   * folder's own path. */
  onMoveFolder?: (path: string) => void
  /** A folder row's "New note…" was picked (M35/FEAT-0072); `path` is that
   * folder's own path, the new note's intended parent. */
  onCreateNoteIn?: (path: string) => void
  /** A note row's "Rename…" was picked (M35/FEAT-0072); `path` is that note's
   * own path. */
  onRenameNote?: (path: string) => void
  /** A folder row's "Rename…" was picked (M35/FEAT-0072); `path` is that
   * folder's own path. */
  onRenameFolder?: (path: string) => void
  /** A note was dragged and dropped onto `destination` (M35/FEAT-0072, "" is
   * the root) — the drag-and-drop equivalent of picking `destination` in the
   * "Move…" picker. */
  onDropNote?: (path: string, destination: string) => void
  /** A folder was dragged and dropped onto `destination` (M35/FEAT-0072, ""
   * is the root). */
  onDropFolder?: (path: string, destination: string) => void
}

/** What's currently being dragged in the tree (M35/FEAT-0072) — only one
 * drag is ever in flight, so a single module-level slot is enough; native
 * `DataTransfer` can't be read during `dragover` (only at `drop`), so this is
 * the source of truth for "can I drop here" and "what am I dropping". */
let draggedItem: { kind: "note" | "folder"; path: string } | null = null

/**
 * Every unique folder path implied by `notes` (the same prefix-walk
 * {@link buildNoteTree} does internally, collected instead of built into
 * nodes) unioned with `folders` (M35/FEAT-0069's explicit empty-folder list) —
 * a flat, sorted destination list for the "Move to…" picker (M35/FEAT-0070).
 * Root is deliberately not included here; only the picker knows to special-case
 * it as "(root)".
 */
export function derivedFolderPaths(notes: string[], folders: string[]): string[] {
  const set = new Set<string>(folders)
  for (const path of notes) {
    const segments = path.split("/")
    let prefix = ""
    for (let i = 0; i < segments.length - 1; i++) {
      prefix = prefix ? `${prefix}/${segments[i]}` : segments[i]
      set.add(prefix)
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
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
 * container each call. `folders` (M35/FEAT-0069) lists any folders with no
 * notes in them, so they still render (empty) rather than disappearing.
 */
export function renderNoteList(
  container: HTMLElement,
  notes: string[],
  active: string,
  handlers: NoteListHandlers,
  expanded: ReadonlySet<string> = new Set(),
  folders: string[] = [],
): void {
  container.replaceChildren()
  for (const node of buildNoteTree(notes, folders)) {
    container.append(renderNode(node, active, handlers, expanded))
  }
  // The root drop zone (M35/FEAT-0072) lives on `container` itself, which
  // (unlike its children) survives every re-render — wire it once, not once
  // per render, or a long session would stack up one listener per render.
  if (!container.dataset.dropZoneWired) {
    container.dataset.dropZoneWired = "true"
    wireDropTarget(container, () => "", handlers)
  }
}

/** Wire a row/header element to open `items` on right-click and on long-press
 * (M35/FEAT-0071) — the single reachability path for every tree row action,
 * replacing what used to be a permanent inline button per action. */
function wireTreeMenu(el: HTMLElement, items: () => TreeMenuItem[]): void {
  el.addEventListener("contextmenu", (event) => {
    event.preventDefault()
    openTreeMenu(event.clientX, event.clientY, items())
  })
  wireLongPress(el, (x, y) => openTreeMenu(x, y, items()))
}

/** Make `el` a drag source (M35/FEAT-0072) — `dragstart` records what's being
 * dragged in the shared `draggedItem` slot; `dragend` clears it regardless of
 * whether the drop landed anywhere valid. */
function wireDragSource(el: HTMLElement, kind: "note" | "folder", path: string): void {
  el.setAttribute("draggable", "true") // the attribute, not just the IDL property — happy-dom doesn't reflect the latter
  el.addEventListener("dragstart", (event) => {
    draggedItem = { kind, path }
    event.dataTransfer?.setData("text/plain", path) // some engines require *some* data for the drag to register
  })
  el.addEventListener("dragend", () => {
    draggedItem = null
  })
}

/** True when dropping whatever's currently dragged onto `destination` is a
 * move that could actually succeed — refuses a dragged folder dropped onto
 * itself or one of its own descendants, the same guard `moveFolder` itself
 * enforces (`isWithin`), so the UI's hint agrees with what a drop actually does. */
function isValidDropTarget(destination: string): boolean {
  if (!draggedItem) return false
  if (draggedItem.kind === "folder" && isWithin(destination, draggedItem.path)) return false
  return true
}

/** Make `el` a drop target that moves whatever's dragged onto
 * `getDestination()` (M35/FEAT-0072 — `""` for the tree root). Both events
 * stop propagating once accepted, so a drop on a specific row's target never
 * also fires an ancestor's (e.g. the root zone's). */
function wireDropTarget(el: HTMLElement, getDestination: () => string, handlers: NoteListHandlers): void {
  el.addEventListener("dragover", (event) => {
    // This element is the intended drop target for anything hovering over
    // it — never an ancestor drop zone (e.g. the root) — regardless of
    // whether *this* target turns out to be valid for what's being dragged.
    event.stopPropagation()
    if (!isValidDropTarget(getDestination())) return // no valid-drop indicator (AC-7)
    event.preventDefault() // required to permit a drop here at all
    el.classList.add("tree-drop-target")
  })
  el.addEventListener("dragleave", () => {
    el.classList.remove("tree-drop-target")
  })
  el.addEventListener("drop", (event) => {
    el.classList.remove("tree-drop-target")
    // Same reasoning as dragover: claim the event so an invalid drop here
    // doesn't bubble up and get silently reinterpreted by an ancestor zone.
    event.preventDefault()
    event.stopPropagation()
    const destination = getDestination()
    const valid = isValidDropTarget(destination) // read before clearing draggedItem below
    const item = draggedItem
    draggedItem = null
    if (!item || !valid) return
    if (item.kind === "note") handlers.onDropNote?.(item.path, destination)
    else handlers.onDropFolder?.(item.path, destination)
  })
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

  wireTreeMenu(header, () => [
    { label: "New subfolder…", run: () => handlers.onCreateFolder?.(node.path) },
    { label: "New note…", run: () => handlers.onCreateNoteIn?.(node.path) },
    { label: "Rename…", run: () => handlers.onRenameFolder?.(node.path) },
    { label: "Move…", run: () => handlers.onMoveFolder?.(node.path) },
    { label: "Delete", run: () => handlers.onDeleteFolder?.(node.path) },
  ])
  wireDragSource(header, "folder", node.path)
  wireDropTarget(header, () => node.path, handlers)

  folder.append(header, children)
  return folder
}

/** Render a single note row (just the name — every other action lives behind
 * its context menu, M35/FEAT-0071). */
function renderNoteRow(node: NoteLeaf, active: string, handlers: NoteListHandlers): HTMLElement {
  const row = document.createElement("div")
  row.className = "note-row"
  row.dataset.path = node.path
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

  row.append(nameButton)

  wireTreeMenu(row, () => [
    { label: "Rename…", run: () => handlers.onRenameNote?.(node.path) },
    { label: "Move…", run: () => handlers.onMoveNote?.(node.path) },
    { label: "Delete", run: () => handlers.onDelete(node.path) },
  ])
  wireDragSource(row, "note", node.path)

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
  settings: HTMLElement
  identity: HTMLElement
  resizer: HTMLElement
  actionBar: HTMLElement
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
  refs.settings.hidden = false
  refs.identity.hidden = false
  refs.resizer.hidden = false // the sidebar is on screen now, so the resize handle applies (FEAT-0044)
  refs.actionBar.hidden = false // the header action bar applies once a folder is open (FEAT-0058)
}

/**
 * Render `actions` into `container` as the header action bar (FEAT-0058): clear it,
 * then append one **icon-only** `<button class="action-bar-button">` per action,
 * wired to that action's `run`. The label is the button's `title` (tooltip) and
 * `aria-label` (accessible name), not visible text — so the header stays compact.
 * An action with no icon falls back to a visible label so the button is never blank.
 */
export function renderActionBar(container: HTMLElement, actions: readonly Action[]): void {
  container.replaceChildren()
  for (const action of actions) {
    const button = document.createElement("button")
    button.type = "button"
    button.className = "action-bar-button"
    button.title = action.label
    button.setAttribute("aria-label", action.label)
    if (action.icon) {
      button.append(createElement(action.icon, { class: "action-bar-icon", "aria-hidden": "true" }))
    } else {
      button.textContent = action.label // no icon — show the label so it isn't blank
    }
    button.addEventListener("click", action.run)
    container.append(button)
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
    // Suppress the collapse/expand `flex-basis` transition (FEAT-0068) for the drag,
    // so the column tracks the cursor instead of easing a frame behind it each move.
    sidebar.classList.add("resizing")

    const onMove = (ev: PointerEvent) => {
      width = clampSidebarWidth(startWidth + ev.clientX - startX)
      setWidth(width)
    }
    const onEnd = () => {
      handle.removeEventListener("pointermove", onMove)
      handle.removeEventListener("lostpointercapture", onEnd)
      document.body.style.userSelect = ""
      sidebar.classList.remove("resizing")
      opts.onChange(width)
    }
    handle.addEventListener("pointermove", onMove)
    handle.addEventListener("lostpointercapture", onEnd)
  })
}

/**
 * Enable motion (FEAT-0068) by adding `motion-ready` to the document root *after* the
 * first paint — two chained frames, so the initial render (loading → welcome/workspace,
 * the async theme apply) has fully settled before the motion tokens resolve to non-zero
 * durations. Without this gate those first state changes would animate, reintroducing
 * the welcome/theme flash FEAT-0031 fought to remove.
 */
export function markMotionReady(root: HTMLElement = document.documentElement): void {
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add("motion-ready")))
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
