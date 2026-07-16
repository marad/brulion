import { createElement } from "lucide"
import { pickFolder } from "./fs"
import { hasPermission, requestAccess } from "./session"
import { displayName } from "./note-name"
import { openTreeMenu, type TreeMenuItem } from "./tree-menu"
import {
  isModifierKey,
  isTypeaheadKey,
  resolveTreeKey,
  treeDepth,
  typeaheadMatch,
  type TreeRow,
} from "./tree-nav"
import { wireLongPress } from "./long-press"
import { isWithin, type AddNoteResult } from "./note-controller"
import { applyAntiAutofillAttrs } from "./anti-autofill"
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

/** Whether `item` still corresponds to something in this render's data — a
 * note must still be in `notes`; a folder must either be listed explicitly
 * (an empty one) or still contain at least one note (M35/FEAT-0072). */
function draggedItemStillExists(
  item: { kind: "note" | "folder"; path: string },
  notes: string[],
  folders: string[],
): boolean {
  if (item.kind === "note") return notes.includes(item.path)
  return folders.includes(item.path) || notes.some((path) => path.startsWith(item.path + "/"))
}

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
  // If focus is currently on a tree row, this rebuild (which replaces every
  // row element) would drop it to <body>. Restore it to the roving tab stop
  // afterward so keyboard flow survives an activation-triggered re-render
  // (open a note with Enter → focus lands on its row → arrow on — M36/
  // FEAT-0075). Guarded on focus *already* being in the tree, so a background
  // poller repaint while the user is typing in the editor never steals focus.
  const restoreTreeFocus = container.contains(document.activeElement)
  container.replaceChildren()
  // A rebuild mid-drag (e.g. the background poller repainting the list after
  // a genuine external change while the user is still holding a drag) always
  // detaches the dragged row, and the browser may never fire its `dragend` on
  // an element no longer in the DOM — but the drag itself is still perfectly
  // valid as long as whatever's being dragged still exists; only clearing
  // `draggedItem` unconditionally here would silently kill an in-progress
  // drag over an unrelated, still-valid re-render. Clear it only when the
  // dragged path is actually gone from this render's data (deleted, or moved
  // out from under the drag by whatever triggered the rebuild).
  if (draggedItem && !draggedItemStillExists(draggedItem, notes, folders)) draggedItem = null
  for (const node of buildNoteTree(notes, folders)) {
    container.append(renderNode(node, active, handlers, expanded))
  }
  container.setAttribute("role", "tree") // M36/FEAT-0075
  // Roving tabindex (M36/FEAT-0075): exactly one row is Tab-focusable — the
  // active note's row, or the first row when none is active — so the whole tree
  // is a single tab stop rather than one per row.
  applyRovingTabindex(container, active)
  if (restoreTreeFocus) {
    container
      .querySelector<HTMLElement>(".folder-header[tabindex='0'], .note-name[tabindex='0']")
      ?.focus()
  }
  // The root drop zone (M35/FEAT-0072) and the keyboard-nav handler
  // (M36/FEAT-0075) live on `container` itself, which (unlike its children)
  // survives every re-render — wire each once, not once per render, or a long
  // session would stack up one listener per render.
  if (!container.dataset.dropZoneWired) {
    container.dataset.dropZoneWired = "true"
    wireDropTarget(container, () => "", handlers)
  }
  if (!container.dataset.keyNavWired) {
    container.dataset.keyNavWired = "true"
    wireTreeKeyNav(container, handlers)
  }
}

/** Every focusable tree row (a folder header or a note name), in draw order —
 * the elements the roving tabindex and keyboard nav operate on. */
function rowFocusables(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(".folder-header, .note-name")]
}

/** The *visible* rows only — a collapsed folder's children are in the DOM but
 * inside a `hidden` `.folder-children`, and are skipped (M36/FEAT-0075). */
function visibleRowFocusables(container: HTMLElement): HTMLElement[] {
  return rowFocusables(container).filter((el) => !el.closest(".folder-children[hidden]"))
}

/** Promote exactly one row to `tabindex="0"` (the tab stop) and demote the rest
 * to `-1`. Prefers the active note's row; falls back to the first row. */
function applyRovingTabindex(container: HTMLElement, active: string): void {
  const focusables = rowFocusables(container)
  const chosen =
    focusables.find((el) => el.dataset.path === active && el.classList.contains("note-name")) ??
    focusables[0]
  for (const el of focusables) el.tabIndex = el === chosen ? 0 : -1
}

/** Move the roving tab stop to `el` and focus it. */
function focusRow(container: HTMLElement, el: HTMLElement): void {
  for (const other of rowFocusables(container)) other.tabIndex = other === el ? 0 : -1
  el.focus()
}

/** How long a typeahead search buffer lives after the last keystroke before it
 * resets (M37/FEAT-0077) — the coalescing window, WAI-ARIA-typical. */
const TYPEAHEAD_TIMEOUT_MS = 500

/** One `keydown` handler for the whole tree (M36/FEAT-0075): standard ARIA
 * `tree` movement over the visible rows, plus F2-to-rename (M37/FEAT-0076) and
 * typeahead (M37/FEAT-0077). Delegates the movement/activation/rename decision
 * to the pure `resolveTreeKey`, then executes it against the DOM — focus a row
 * (carrying the tab stop), toggle a folder via its header's existing click (so
 * FEAT-0043's persistence runs), activate the focused row, or open its rename
 * prompt (routing to the note- vs folder-rename entry point by kind, the same
 * ones the context menu uses). A printable key that resolves to no action drives
 * typeahead: it moves focus to the next visible row whose label matches the
 * accumulated buffer. Only acts when focus is on a row, so it never interferes
 * with the editor or any overlay. */
function wireTreeKeyNav(container: HTMLElement, handlers: NoteListHandlers): void {
  // Typeahead state, scoped to this container's one-time wiring: the buffer
  // accumulates quick successive keystrokes and a timer resets it after the
  // coalescing window (FEAT-0077).
  let typeaheadBuffer = ""
  let typeaheadTimer: ReturnType<typeof setTimeout> | undefined
  const resetTypeahead = () => {
    clearTimeout(typeaheadTimer)
    typeaheadBuffer = ""
  }
  // Leaving the tree ends the session, so re-entering and typing within the
  // window starts fresh instead of extending a stale prefix. focusout bubbles;
  // moving focus *between* rows keeps it inside the container (relatedTarget is
  // another row) and must not reset — only a move out of the tree does.
  container.addEventListener("focusout", (event) => {
    if (!container.contains(event.relatedTarget as Node | null)) resetTypeahead()
  })

  container.addEventListener("keydown", (event) => {
    const focused = (event.target as HTMLElement | null)?.closest<HTMLElement>(
      ".folder-header, .note-name",
    )
    if (!focused || !container.contains(focused)) return
    const els = visibleRowFocusables(container)
    const current = els.indexOf(focused)
    if (current === -1) return
    const descriptors: TreeRow[] = els.map((el) => ({
      path: el.dataset.path ?? "",
      kind: el.classList.contains("folder-header") ? "folder" : "note",
      expanded: el.getAttribute("aria-expanded") === "true",
      depth: treeDepth(el.dataset.path ?? ""),
    }))
    const action = resolveTreeKey(event.key, descriptors, current)
    if (action.type === "none") {
      // A printable key that no tree action claims drives typeahead — move focus
      // to the next visible row whose shown label matches the buffer (FEAT-0077).
      if (isTypeaheadKey(event)) {
        // A repeat of the single buffered character keeps the buffer one char so
        // the same letter cycles through matches instead of growing to "aa"
        // (which would match nothing) — file-explorer behavior (AC-4).
        if (typeaheadBuffer !== event.key) typeaheadBuffer += event.key
        clearTimeout(typeaheadTimer)
        typeaheadTimer = setTimeout(resetTypeahead, TYPEAHEAD_TIMEOUT_MS)
        const labels = els.map((el) => el.textContent ?? "")
        const idx = typeaheadMatch(labels, current, typeaheadBuffer)
        if (idx !== -1) {
          event.preventDefault()
          focusRow(container, els[idx])
        }
      } else if (!isModifierKey(event.key)) {
        // A non-typeahead key that claims no action (a boundary arrow, Escape,
        // Tab) ends the session; a bare modifier press does not, so Shift+letter
        // still composes a two-character search (AC-8).
        resetTypeahead()
      }
      return
    }
    // A real tree action ends any in-progress typeahead session, so a letter
    // typed right after an arrow/Enter/F2 starts a fresh search rather than
    // extending a stale buffer within the coalescing window (AC-8).
    resetTypeahead()
    event.preventDefault() // handled keys never scroll the sidebar or double-activate a button
    switch (action.type) {
      case "focus":
        focusRow(container, els[action.index])
        break
      case "expand":
      case "collapse":
      case "activate":
        // Reuse the row's own click: a folder header toggles + persists
        // (FEAT-0043); a note name opens it. One code path, no divergence.
        els[action.index].click()
        break
      case "rename": {
        // Reuse the context-menu rename entry points (FEAT-0072) — one rename
        // path, no divergence; F2 itself writes nothing (the prompt does, on commit).
        const target = descriptors[action.index]
        if (target.kind === "folder") handlers.onRenameFolder?.(target.path)
        else handlers.onRenameNote?.(target.path)
        break
      }
    }
  })
}

/** Wire a row/header element to open `items` on right-click, on long-press
 * (M35/FEAT-0071), and on the standard keyboard context-menu shortcut
 * (Shift+F10, or a keyboard's dedicated "Menu"/"ContextMenu" key) — the only
 * way a keyboard-only user can reach these actions, since right-click and
 * long-press both require a pointer. A folder header is itself focusable; a
 * note row isn't, but its keydown bubbles up from its focusable name button,
 * so listening on `el` catches both without any extra wiring. */
function wireTreeMenu(el: HTMLElement, items: () => TreeMenuItem[]): void {
  el.addEventListener("contextmenu", (event) => {
    event.preventDefault()
    openTreeMenu(event.clientX, event.clientY, items())
  })
  wireLongPress(el, (x, y) => openTreeMenu(x, y, items()))
  el.addEventListener("keydown", (event) => {
    if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return
    event.preventDefault()
    // The element actually holding focus (a folder header, or a note row's name
    // button) — refocus it when the keyboard-opened menu closes, so the user
    // lands back where they were (M35/FEAT-0071/AC-8) instead of on <body>.
    const opener = document.activeElement as HTMLElement | null
    const rect = el.getBoundingClientRect()
    openTreeMenu(rect.left, rect.bottom, items(), {
      fromKeyboard: true,
      onDismiss: () => opener?.focus(),
    })
  })
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
  if (draggedItem.kind === "folder") {
    if (isWithin(destination, draggedItem.path)) return false
    // Dropping a folder back onto its own current parent (or the root, for a
    // root-level folder) is a no-op the user almost certainly didn't intend
    // as "move it" — moveFolder's own guard would otherwise refuse this with
    // the same message as a genuine self-nest attempt, which reads as a
    // confusing error for what was really just a mis-drop.
    if (destination === parentOf(draggedItem.path)) return false
  }
  return true
}

/** The folder-relative parent of `path` ("" at the root) — mirrors
 * `note-controller.ts`'s private `folderOf`/`main.ts`'s `parentOf`. */
function parentOf(path: string): string {
  const slash = path.lastIndexOf("/")
  return slash === -1 ? "" : path.slice(0, slash)
}

/** Make `el` a drop target that moves whatever's dragged onto
 * `getDestination()` (M35/FEAT-0072 — `""` for the tree root). Both events
 * stop propagating once accepted, so a drop on a specific row's target never
 * also fires an ancestor's (e.g. the root zone's). */
function wireDropTarget(el: HTMLElement, getDestination: () => string, handlers: NoteListHandlers): void {
  // The drop indicator highlights the whole destination *folder block* (its
  // header plus everything nested under it), not just the row the pointer is
  // over: a drop on a note row targets that note's containing folder (AC-9),
  // so highlighting only the hovered row would point at the wrong place
  // (M35/FEAT-0072/AC-10). A drop targeting the vault root (a root-level note
  // row, or the root zone itself) has no folder block, so it highlights the
  // whole tree container — the element the root drop zone is wired on
  // (`[data-drop-zone-wired]`). Computed at event time (not render time) so a
  // root-level row, appended after wiring, still resolves its container.
  const highlightEl = (): HTMLElement =>
    el.closest<HTMLElement>(".note-folder") ??
    el.closest<HTMLElement>("[data-drop-zone-wired]") ??
    el
  el.addEventListener("dragover", (event) => {
    // This element is the intended drop target for anything hovering over
    // it — never an ancestor drop zone (e.g. the root) — regardless of
    // whether *this* target turns out to be valid for what's being dragged.
    event.stopPropagation()
    if (!isValidDropTarget(getDestination())) return // no valid-drop indicator (AC-7)
    event.preventDefault() // required to permit a drop here at all
    highlightEl().classList.add("tree-drop-target")
  })
  el.addEventListener("dragleave", () => {
    highlightEl().classList.remove("tree-drop-target")
  })
  el.addEventListener("drop", (event) => {
    highlightEl().classList.remove("tree-drop-target")
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
  header.dataset.path = node.path // read by keyboard nav to build row descriptors (M36)
  header.setAttribute("role", "treeitem")
  header.setAttribute("aria-level", String(treeDepth(node.path) + 1))
  header.setAttribute("aria-expanded", String(!isCollapsed))
  header.tabIndex = -1 // roving tabindex (M36/FEAT-0075): renderNoteList promotes one row to 0

  const children = document.createElement("div")
  children.className = "folder-children"
  children.setAttribute("role", "group")
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
  nameButton.dataset.path = node.path // read by keyboard nav to build row descriptors (M36)
  nameButton.setAttribute("role", "treeitem")
  nameButton.setAttribute("aria-level", String(treeDepth(node.path) + 1))
  nameButton.tabIndex = -1 // roving tabindex (M36/FEAT-0075): renderNoteList promotes one row to 0
  nameButton.addEventListener("click", () => handlers.onSelect(node.path))

  row.append(nameButton)

  wireTreeMenu(row, () => [
    { label: "Rename…", run: () => handlers.onRenameNote?.(node.path) },
    { label: "Move…", run: () => handlers.onMoveNote?.(node.path) },
    { label: "Delete", run: () => handlers.onDelete(node.path) },
  ])
  wireDragSource(row, "note", node.path)
  // A note isn't a container, but its row is the easiest target to hit when
  // the intent is "put this alongside that note" — drop here targets its
  // own containing folder, same as dropping directly on that folder's
  // header would (M35/FEAT-0072/AC-9).
  wireDropTarget(row, () => parentOf(node.path), handlers)

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
  applyAntiAutofillAttrs(input)
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
