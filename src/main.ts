import "./styles.css"
import { mountEditor, setEditorEditable, setVimMode } from "./editor"
import { createNoteController, type NoteController } from "./note-controller"
import { mountConflictDiff, type ConflictDiff } from "./conflict-view"
import {
  wireOpenFolder,
  restoreFolder,
  renderNoteList,
  wireNewNote,
  wireToggle,
} from "./ui"
import {
  saveSidebarCollapsed,
  loadSidebarCollapsed,
  saveVimMode,
  loadVimMode,
  saveCollapsedFolders,
  loadCollapsedFolders,
} from "./session"
import { displayName } from "./note-name"
import { wireFlushOnHide } from "./flush"
import { createPoller } from "./watch"

/** How often to poll the folder for changes made by other tools (FEAT-0014). */
const POLL_MS = 2000

const editorEl = document.querySelector<HTMLDivElement>("#editor")
const workspaceEl = document.querySelector<HTMLElement>(".workspace")
const sidebarEl = document.querySelector<HTMLElement>("#sidebar")
const toggleSidebarEl = document.querySelector<HTMLButtonElement>("#toggle-sidebar")
const toggleVimEl = document.querySelector<HTMLButtonElement>("#toggle-vim")
const listEl = document.querySelector<HTMLElement>("#note-list")
const newNoteForm = document.querySelector<HTMLFormElement>("#new-note")
const newNoteInput = document.querySelector<HTMLInputElement>("#new-note-input")
const openButton = document.querySelector<HTMLButtonElement>("#open-folder")
const resumeButton = document.querySelector<HTMLButtonElement>("#resume-access")
const statusEl = document.querySelector<HTMLParagraphElement>("#status")
const conflictBackdropEl = document.querySelector<HTMLDivElement>("#conflict-backdrop")
const conflictDiffEl = document.querySelector<HTMLDivElement>("#conflict-diff")
const keepButton = document.querySelector<HTMLButtonElement>("#conflict-keep")
const diskButton = document.querySelector<HTMLButtonElement>("#conflict-disk")
if (
  !editorEl ||
  !workspaceEl ||
  !sidebarEl ||
  !toggleSidebarEl ||
  !toggleVimEl ||
  !listEl ||
  !newNoteForm ||
  !newNoteInput ||
  !openButton ||
  !resumeButton ||
  !statusEl ||
  !conflictBackdropEl ||
  !conflictDiffEl ||
  !keepButton ||
  !diskButton
) {
  throw new Error("missing mount points in index.html")
}

// The editor needs the controller and the controller needs the view; the
// callbacks only fire on user interaction, after both are assigned.
let controller: NoteController
const view = mountEditor(editorEl, {
  onChange: () => controller.handleChange(),
  onSave: () => controller.flush(),
})
// The diff view shown while a conflict stands (FEAT-0022); null when none does.
let conflictDiff: ConflictDiff | null = null
// The folders the user left collapsed (FEAT-0024). Loaded before the first
// folder open (openNote awaits it), so the tree's first paint matches the saved
// state instead of flashing fully expanded.
let collapsedFolders = new Set<string>()
const collapsedFoldersReady = loadCollapsedFolders().then((set) => {
  collapsedFolders = set
})
controller = createNoteController(view, {
  onConflict: (versions) => {
    // Modal: show the choice and lock the editor; navigation is blocked in the
    // controller. The only way forward is one of the two resolution buttons.
    // Show the buffer beside the on-disk content so the pick is informed.
    conflictBackdropEl.hidden = false
    setEditorEditable(view, false)
    conflictDiff?.destroy() // defensive: never stack two diffs
    conflictDiff = mountConflictDiff(conflictDiffEl, versions.mine, versions.theirs)
  },
  onConflictResolved: () => {
    conflictBackdropEl.hidden = true
    setEditorEditable(view, true)
    conflictDiff?.destroy()
    conflictDiff = null
  },
  onListChanged: (notes, active) => {
    // A folder is open — reveal the list/new-note control and the collapse
    // toggle. The collapse preference (a CSS class on .workspace) is orthogonal:
    // if the user left the sidebar collapsed it stays hidden by CSS regardless.
    sidebarEl.hidden = false
    toggleSidebarEl.hidden = false
    toggleVimEl.hidden = false
    renderNoteList(
      listEl,
      notes,
      active,
      {
        onSelect: (name) => void controller.switchTo(name),
        onDelete: (name) => {
          if (
            window.confirm(`Delete "${displayName(name)}"? This removes the file from your folder.`)
          ) {
            void controller.removeNote(name)
          }
        },
        onToggleFolder: (path, collapsed) => {
          if (collapsed) collapsedFolders.add(path)
          else collapsedFolders.delete(path)
          void saveCollapsedFolders(collapsedFolders)
        },
      },
      collapsedFolders,
    )
  },
})

// Clear any stale status (e.g. a previous create error) on success.
const clearStatus = () => {
  statusEl.hidden = true
  statusEl.textContent = ""
}

wireNewNote(newNoteForm, newNoteInput, (name) => {
  void controller.addNote(name).then((result) => {
    if (result.ok) {
      clearStatus()
    } else {
      statusEl.textContent = result.reason
      statusEl.hidden = false
    }
  })
})

// One poll loop, started once a folder is open; `start()` is idempotent, so
// re-picking a folder doesn't double-arm it — the single loop follows whichever
// folder the controller currently holds.
const poller = createPoller(() => controller.refreshFromDisk(), POLL_MS)
const openNote = async (dir: FileSystemDirectoryHandle) => {
  await collapsedFoldersReady // first tree paint should match the saved collapse state
  await controller.open(dir)
  poller.start()
}

// The two ways out of a conflict; the controller clears it via onConflictResolved.
keepButton.addEventListener("click", () => void controller.resolveKeepMine())
diskButton.addEventListener("click", () => void controller.resolveTakeTheirs())

wireOpenFolder(openButton, resumeButton, openNote)
void restoreFolder(resumeButton, openNote)

// Sidebar collapse (FEAT-0020): restore the saved preference, wire the header
// toggle, and bind Ctrl+\ to the same flip. CodeMirror has no binding for that
// chord, so the event bubbles to window and never disturbs the editor shortcuts.
void loadSidebarCollapsed().then((collapsed) => {
  const sidebar = wireToggle(toggleSidebarEl, {
    initialOn: collapsed,
    apply: (on) => workspaceEl.classList.toggle("sidebar-collapsed", on),
    onChange: (on) => void saveSidebarCollapsed(on),
  })
  window.addEventListener("keydown", (event) => {
    if (event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey && event.key === "\\") {
      event.preventDefault()
      sidebar.toggle()
    }
  })
})

// Opt-in Vim mode (FEAT-0021): restore the saved choice and wire the header
// toggle. Off by default; turning it on reconfigures the editor's Vim compartment
// in place (no remount).
void loadVimMode().then((on) => {
  wireToggle(toggleVimEl, {
    initialOn: on,
    apply: (value) => setVimMode(view, value),
    onChange: (value) => void saveVimMode(value),
  })
})

// Flush pending edits before the page can go away.
wireFlushOnHide(() => controller.flush())
