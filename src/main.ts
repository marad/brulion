import "./styles.css"
import { mountEditor, setEditorEditable, setVimMode, setLinkContext } from "./editor"
import { createNoteController, type NoteController } from "./note-controller"
import { mountConflictDiff, type ConflictDiff } from "./conflict-view"
import {
  wireOpenFolder,
  restoreFolder,
  renderNoteList,
  wireNewNote,
  wireToggle,
  showWorkspace,
} from "./ui"
import {
  saveSidebarCollapsed,
  loadSidebarCollapsed,
  saveVimMode,
  loadVimMode,
  saveCollapsedFolders,
  loadCollapsedFolders,
} from "./session"
import { displayName, isExternalLink, resolveNotePath } from "./note-name"
import { wireFlushOnHide } from "./flush"
import { createPoller } from "./watch"
import { registerServiceWorker } from "./pwa"
import { createInstallPrompt, type DeferredInstallPrompt } from "./install-prompt"

/** How often to poll the folder for changes made by other tools (FEAT-0014). */
const POLL_MS = 2000

const editorEl = document.querySelector<HTMLDivElement>("#editor")
const workspaceEl = document.querySelector<HTMLElement>(".workspace")
const welcomeEl = document.querySelector<HTMLElement>("#welcome")
const sidebarEl = document.querySelector<HTMLElement>("#sidebar")
const toggleSidebarEl = document.querySelector<HTMLButtonElement>("#toggle-sidebar")
const toggleVimEl = document.querySelector<HTMLButtonElement>("#toggle-vim")
const reopenButton = document.querySelector<HTMLButtonElement>("#reopen-folder")
const listEl = document.querySelector<HTMLElement>("#note-list")
const newNoteForm = document.querySelector<HTMLFormElement>("#new-note")
const newNoteInput = document.querySelector<HTMLInputElement>("#new-note-input")
const openButton = document.querySelector<HTMLButtonElement>("#open-folder")
const resumeButton = document.querySelector<HTMLButtonElement>("#resume-access")
const installButton = document.querySelector<HTMLButtonElement>("#install-app")
const statusEl = document.querySelector<HTMLParagraphElement>("#status")
const conflictBackdropEl = document.querySelector<HTMLDivElement>("#conflict-backdrop")
const conflictDiffEl = document.querySelector<HTMLDivElement>("#conflict-diff")
const keepButton = document.querySelector<HTMLButtonElement>("#conflict-keep")
const diskButton = document.querySelector<HTMLButtonElement>("#conflict-disk")
if (
  !editorEl ||
  !workspaceEl ||
  !welcomeEl ||
  !sidebarEl ||
  !toggleSidebarEl ||
  !toggleVimEl ||
  !reopenButton ||
  !listEl ||
  !newNoteForm ||
  !newNoteInput ||
  !openButton ||
  !resumeButton ||
  !installButton ||
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
// The open note and the known note paths, tracked from onListChanged so a link
// follow (FEAT-0025) can resolve relative to the open note and tell an existing
// target from one to offer to create.
let currentActive = ""
let currentNotes: string[] = []
// Follow a resolved internal note path: switch to it if it exists, else offer to
// create it (shared by markdown links and wikilinks — FEAT-0026/0027).
const openNotePath = (path: string) => {
  if (currentNotes.includes(path)) {
    void controller.switchTo(path)
  } else if (window.confirm(`"${displayName(path)}" doesn't exist yet. Create it?`)) {
    void controller.addNote(path)
  }
}
const view = mountEditor(editorEl, {
  onChange: () => controller.handleChange(),
  onSave: () => controller.flush(),
  onFollowLink: (href) => {
    if (isExternalLink(href)) {
      // Open in a new tab via a real anchor click — `window.open(_, _, "noopener")`
      // opens a popup window (not a tab) in some browsers (FEAT-0026).
      const anchor = document.createElement("a")
      anchor.href = href
      anchor.target = "_blank"
      anchor.rel = "noopener noreferrer"
      anchor.click()
      return
    }
    const target = resolveNotePath(currentActive, href)
    if (target) openNotePath(target) // null = escapes the root / not a note — inert
  },
  // A wikilink (FEAT-0027) already carries its resolved absolute note path.
  onFollowNote: (path) => openNotePath(path),
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
    // A folder is open — swap the welcome hero for the workspace and reveal the
    // in-note header controls (FEAT-0031). The collapse preference (a CSS class on
    // .workspace) is orthogonal: if the user left the sidebar collapsed it stays
    // hidden by CSS regardless.
    showWorkspace({
      welcome: welcomeEl,
      sidebar: sidebarEl,
      toggleSidebar: toggleSidebarEl,
      toggleVim: toggleVimEl,
      reopen: reopenButton,
    })
    // Feed the editor the open note + known paths so links render valid-vs-broken
    // and a follow resolves relative to the right note (FEAT-0025).
    currentActive = active
    currentNotes = notes
    setLinkContext(view, { activeNote: active, notePaths: new Set(notes) })
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
// Re-pick a different folder once one is open (FEAT-0031): same open flow, driven
// from the header (the welcome CTA is hidden behind the workspace by then).
wireOpenFolder(reopenButton, resumeButton, openNote)
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

// Register the offline service worker (FEAT-0029) — production builds only; the
// dev server serves unbundled modules + an HMR client the worker shouldn't cache.
registerServiceWorker(navigator, import.meta.env.BASE_URL, import.meta.env.PROD)

// Custom install affordance (FEAT-0030): capture beforeinstallprompt, reveal a
// header Install button, and fire the native prompt on click. Hidden while
// already installed (display-mode: standalone) or before the event arrives.
const isStandalone =
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as { standalone?: boolean }).standalone === true
const install = createInstallPrompt(isStandalone, (visible) => {
  installButton.hidden = !visible
})
window.addEventListener("beforeinstallprompt", (event) => {
  install.onBeforeInstallPrompt(event as unknown as DeferredInstallPrompt)
})
window.addEventListener("appinstalled", () => install.onInstalled())
installButton.addEventListener("click", () => install.onInstallClick())
