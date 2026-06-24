import "./styles.css"
import { mountEditor, setEditorEditable, setLinkContext } from "./editor"
import { createNoteController, type NoteController } from "./note-controller"
import { mountConflictDiff, type ConflictDiff } from "./conflict-view"
import {
  wireOpenFolder,
  restoreFolder,
  renderNoteList,
  wireToggle,
  wireSidebarResize,
  showWorkspace,
  mountNoteIdentity,
  mountMissingNoteBanner,
  type NoteIdentityHandle,
} from "./ui"
import { mountQuickSwitcher } from "./quick-switcher"
import {
  saveSidebarCollapsed,
  loadSidebarCollapsed,
  saveExpandedFolders,
  loadExpandedFolders,
  saveSidebarWidth,
  loadSidebarWidth,
  saveRecency,
  loadRecency,
} from "./session"
import {
  loadSettings,
  saveSettings,
  applySettings,
  DEFAULT_SETTINGS,
  type Settings,
} from "./settings"
import { mountSettingsModal, type SettingsModalHandle } from "./settings-modal"
import { resolveFontChoices } from "./font-access"
import { touchRecency } from "./note-search"
import { displayName, isExternalLink, resolveNotePath } from "./note-name"
import { pathToHash, hashToPath } from "./note-route"
import { wireFlushOnHide } from "./flush"
import { createPoller } from "./watch"
import { registerServiceWorker } from "./pwa"
import { createInstallPrompt, type DeferredInstallPrompt } from "./install-prompt"

/** How often to poll the folder for changes made by other tools (FEAT-0014). */
const POLL_MS = 2000

/** Below this viewport width the sidebar renders as a slide-over drawer (FEAT-0051). */
const MOBILE = window.matchMedia("(max-width: 40rem)")
/** Close the sidebar drawer when in the narrow layout — assigned once the sidebar
 * toggle is wired. A no-op on desktop (and before wiring). Used after a note-select
 * so the drawer dismisses to reveal the note. */
let dismissDrawerIfMobile = (): void => {}

const editorEl = document.querySelector<HTMLDivElement>("#editor")
const workspaceEl = document.querySelector<HTMLElement>(".workspace")
const loadingEl = document.querySelector<HTMLElement>("#loading")
const welcomeEl = document.querySelector<HTMLElement>("#welcome")
const sidebarEl = document.querySelector<HTMLElement>("#sidebar")
const toggleSidebarEl = document.querySelector<HTMLButtonElement>("#toggle-sidebar")
const sidebarResizerEl = document.querySelector<HTMLElement>("#sidebar-resizer")
const sidebarBackdropEl = document.querySelector<HTMLElement>("#sidebar-backdrop")
const openSettingsEl = document.querySelector<HTMLButtonElement>("#open-settings")
const settingsBackdropEl = document.querySelector<HTMLElement>("#settings-backdrop")
const noteIdentityEl = document.querySelector<HTMLElement>("#note-identity")
const missingNoteEl = document.querySelector<HTMLElement>("#missing-note")
const reopenButton = document.querySelector<HTMLButtonElement>("#reopen-folder")
const listEl = document.querySelector<HTMLElement>("#note-list")
const sidebarSearchEl = document.querySelector<HTMLButtonElement>("#sidebar-search")
const switcherBackdropEl = document.querySelector<HTMLDivElement>("#switcher-backdrop")
const switcherInputEl = document.querySelector<HTMLInputElement>("#switcher-input")
const switcherListEl = document.querySelector<HTMLElement>("#switcher-list")
const switcherErrorEl = document.querySelector<HTMLElement>("#switcher-error")
const openButton = document.querySelector<HTMLButtonElement>("#open-folder")
const resumeButton = document.querySelector<HTMLButtonElement>("#resume-access")
const installButton = document.querySelector<HTMLButtonElement>("#install-app")
const conflictBackdropEl = document.querySelector<HTMLDivElement>("#conflict-backdrop")
const conflictDiffEl = document.querySelector<HTMLDivElement>("#conflict-diff")
const keepButton = document.querySelector<HTMLButtonElement>("#conflict-keep")
const diskButton = document.querySelector<HTMLButtonElement>("#conflict-disk")
if (
  !editorEl ||
  !workspaceEl ||
  !loadingEl ||
  !welcomeEl ||
  !sidebarEl ||
  !toggleSidebarEl ||
  !sidebarResizerEl ||
  !sidebarBackdropEl ||
  !openSettingsEl ||
  !settingsBackdropEl ||
  !noteIdentityEl ||
  !missingNoteEl ||
  !reopenButton ||
  !listEl ||
  !sidebarSearchEl ||
  !switcherBackdropEl ||
  !switcherInputEl ||
  !switcherListEl ||
  !switcherErrorEl ||
  !openButton ||
  !resumeButton ||
  !installButton ||
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
// The most-recently-visited note list (FEAT-0039), most-recent first. Fed into the
// quick switcher's ranking (empty-query order + equal-score tiebreak). Loaded once
// before the first folder open (openNote awaits `recencyReady`) so the first
// recorded visit appends to the persisted list instead of racing past it; touched
// on every genuine active-note change and persisted.
let recency: string[] = []
const recencyReady = loadRecency().then((r) => {
  recency = r
})
// The header open-note identity + inline rename (FEAT-0035); assigned right after
// the controller (it renames via controller.renameActive) and repointed from
// onListChanged so the header always names the open note.
let identity: NoteIdentityHandle
// Whether a folder has been opened (workspace shown). Drives the initial
// loading → welcome-vs-workspace resolution so the welcome never flashes before
// an auto-restored folder loads (FEAT-0031).
let workspaceShown = false
// Note URL hash route (FEAT-0036). The open note mirrors into `#/path` so the
// browser's own Back/Forward walks visit history. `suppressRouteSync` silences the
// mirror while we resolve the initial hash on load (so that resolution leaves a
// single history entry, settled with replaceState); `initialRouteConsumed` makes
// the load-time hash resolution happen exactly once (the first folder open).
let suppressRouteSync = false
let initialRouteConsumed = false
// Mirror the active note into the location hash. No-op when already mirrored —
// which both avoids a duplicate history entry and is the loop guard against the
// hashchange listener reading our own write back as a fresh navigation. Comparing
// decoded paths (not raw hash strings) stays robust to browser hash re-encoding.
//
// Push vs replace: a genuine navigation (the user opened a different, still-existing
// note) pushes, so Back returns to the prior note. But when the note the URL points
// at is gone from the list, the active note changed because the old one was
// renamed/deleted out from under us — not navigation. Replacing the now-dead entry
// keeps the URL in sync with the open note (else Back would land on a vanished note
// and the address bar would disagree with what's open).
const syncRouteToActive = (active: string) => {
  if (suppressRouteSync) return
  const current = hashToPath(location.hash)
  if (current === active) return
  const hash = pathToHash(active)
  if (current !== null && !currentNotes.includes(current)) {
    history.replaceState(null, "", hash) // old note vanished (rename/delete) — replace, don't push
  } else {
    location.hash = hash // genuine navigation — push a history entry
  }
}
// Classify what the current URL hash means against the open folder (FEAT-0036).
// `none` — malformed, or names the already-open note (the loop guard against our
// own mirror writes); ignored. `switch` — names an existing note; navigate to it.
// `missing` — well-formed but names a note absent from the folder; raise the
// missing-note banner (offer to create it) rather than silently desync the URL.
// One classifier for both the load-time resolution and the hashchange path.
type HashResolution =
  | { kind: "none" }
  | { kind: "switch"; path: string }
  | { kind: "missing"; path: string }
const resolveHash = (): HashResolution => {
  const target = hashToPath(location.hash)
  if (target === null || target === currentActive) return { kind: "none" }
  return currentNotes.includes(target) ? { kind: "switch", path: target } : { kind: "missing", path: target }
}
// The missing-note banner (FEAT-0036). Shown when a hash names a note absent from
// the folder; `pendingMissingTarget` is the note path it currently offers to
// create. Create makes that note (the route's one explicit, user-gated write — the
// resulting active-note announcement hides the banner and validates the hash);
// dismiss re-syncs the URL back to the open note so the bar stops naming an absent
// note. The banner is also hidden on any active-note change (in onListChanged), so
// it never outlives the state it described.
let pendingMissingTarget: string | null = null
const missingBanner = mountMissingNoteBanner(missingNoteEl, {
  onCreate: () => {
    const target = pendingMissingTarget
    if (!target) return
    clearMissingBanner() // synchronous, so a double-click can't fire a second create
    void controller.addNote(displayName(target))
  },
  onDismiss: () => {
    clearMissingBanner()
    history.replaceState(null, "", pathToHash(currentActive)) // stop the URL naming an absent note
  },
})
const clearMissingBanner = () => {
  missingBanner.hide()
  pendingMissingTarget = null
}
const showMissingBanner = (target: string) => {
  pendingMissingTarget = target
  missingBanner.show(displayName(target))
}
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
// User settings (M16/FEAT-0047): font, text size, editor width, Vim. The single
// source of truth is `.brulion.json` in the open folder — no idb cache. Before a
// folder opens the built-in defaults apply (the editor theme's var fallbacks cover
// the no-folder look). `settingsDir` is the folder we persist back into; null until
// one is open. Loaded and applied per folder open (in openNote).
let currentSettings: Settings = DEFAULT_SETTINGS
let settingsDir: FileSystemDirectoryHandle | null = null
const persistSettings = (): Promise<void> =>
  settingsDir ? saveSettings(settingsDir, currentSettings) : Promise.resolve()
// The settings modal (FEAT-0048); forward-declared so updateSettings can re-sync it
// after a change (e.g. a `Ctrl/Cmd+;` Vim toggle reflects in the open modal) — the
// modal is mounted further down, which breaks the onChange↔sync cycle.
let settingsModal: SettingsModalHandle | null = null
// True only while openNote is reading a folder's settings — blocks a concurrent
// `Ctrl/Cmd+;` from mutating/persisting against the outgoing folder (and being
// clobbered by the load that's about to assign `currentSettings`).
let loadingSettings = false
// The single settings mutator: merge a patch, apply it live, re-sync the modal,
// persist.
const updateSettings = (patch: Partial<Settings>) => {
  currentSettings = { ...currentSettings, ...patch }
  applySettings(view, currentSettings)
  settingsModal?.sync()
  void persistSettings()
}
const toggleVim = () => {
  if (loadingSettings) return // mid folder-open: ignore, the loaded value wins
  updateSettings({ vim: !currentSettings.vim })
}

// The diff view shown while a conflict stands (FEAT-0022); null when none does.
let conflictDiff: ConflictDiff | null = null
// The folders the user expanded (FEAT-0043); every other folder renders collapsed
// by default. Loaded before the first folder open (openNote awaits it), so the
// tree's first paint matches the saved state instead of flashing fully collapsed.
let expandedFolders = new Set<string>()
const expandedFoldersReady = loadExpandedFolders().then((set) => {
  expandedFolders = set
})
// Drag-to-resize the sidebar (FEAT-0044): restore the saved width onto the
// sidebar's flex-basis var and persist the new width on each drag end. The handle
// is revealed with the workspace (showWorkspace) and hidden by CSS while the
// sidebar is collapsed. openNote awaits this before the first paint, so a saved
// width applies with no flash of the default basis.
const sidebarWidthReady = loadSidebarWidth().then((px) => {
  wireSidebarResize(sidebarResizerEl, sidebarEl, {
    initialWidth: px,
    onChange: (width) => void saveSidebarWidth(width),
  })
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
    workspaceShown = true
    loadingEl.hidden = true
    showWorkspace({
      welcome: welcomeEl,
      sidebar: sidebarEl,
      toggleSidebar: toggleSidebarEl,
      settings: openSettingsEl,
      reopen: reopenButton,
      identity: noteIdentityEl,
      resizer: sidebarResizerEl,
    })
    // Feed the editor the open note + known paths so links render valid-vs-broken
    // and a follow resolves relative to the right note (FEAT-0025).
    currentActive = active
    currentNotes = notes
    // Record the visit (FEAT-0039) on a genuine active-note change only — skip the
    // redundant re-touch when an external list change fires with the same active.
    if (active && recency[0] !== active) {
      recency = touchRecency(recency, active)
      void saveRecency(recency)
    }
    clearMissingBanner() // the active note changed — drop any stale missing-note notice
    syncRouteToActive(active) // mirror the open note into the URL hash (FEAT-0036)
    identity.update(active) // keep the header naming the open note (FEAT-0035)
    setLinkContext(view, { activeNote: active, notePaths: new Set(notes) })
    renderNoteList(
      listEl,
      notes,
      active,
      {
        onSelect: (name) => {
          void controller.switchTo(name)
          dismissDrawerIfMobile() // narrow layout: close the drawer to reveal the note (FEAT-0051)
        },
        onDelete: (name) => {
          if (
            window.confirm(`Delete "${displayName(name)}"? This removes the file from your folder.`)
          ) {
            void controller.removeNote(name)
          }
        },
        onToggleFolder: (path, collapsed) => {
          // The persisted set holds expanded folders (FEAT-0043), so invert:
          // collapsing drops the path, expanding adds it.
          if (collapsed) expandedFolders.delete(path)
          else expandedFolders.add(path)
          void saveExpandedFolders(expandedFolders)
        },
      },
      expandedFolders,
    )
  },
})

// Header open-note identity + click-to-rename (FEAT-0035). Renaming goes through
// the controller's renameActive (flush → native move → follow the file); the
// onListChanged above repoints the display whenever the active note changes.
identity = mountNoteIdentity(noteIdentityEl, (name) => controller.renameActive(name))

// Quick switcher (FEAT-0033): the single find-or-create surface, replacing the old
// sidebar new-note textbox. It reads the in-memory note list and routes to the
// existing switch/create operations; the only write it can cause is an explicit
// create.
const switcher = mountQuickSwitcher(
  {
    backdrop: switcherBackdropEl,
    input: switcherInputEl,
    list: switcherListEl,
    error: switcherErrorEl,
  },
  {
    getNotes: () => currentNotes,
    getRecency: () => recency,
    getActiveNote: () => currentActive,
    openNote: (path) => void controller.switchTo(path),
    createNote: (name) => controller.addNote(name),
  },
)

// The sidebar's visible entry point into the switcher (creation is no longer a
// textbox), and the Ctrl/Cmd+K shortcut. The shortcut is a capture-phase listener
// so neither CodeMirror nor the Vim layer can swallow it first (AC-9).
sidebarSearchEl.addEventListener("click", () => switcher.open())
// Show the platform-correct chord in the hint (the app is meant to run on any
// foreign machine), and match the button's tooltip to it.
{
  const isMac = /mac/i.test(navigator.platform)
  const shortcutEl = document.querySelector<HTMLElement>("#search-shortcut")
  if (shortcutEl) shortcutEl.textContent = isMac ? "⌘K" : "Ctrl K"
  sidebarSearchEl.title = `Find or create a note (${isMac ? "⌘K" : "Ctrl+K"})`
  openSettingsEl.title = `Settings (${isMac ? "⌘," : "Ctrl+,"})`
}
window.addEventListener(
  "keydown",
  (event) => {
    if (
      (event.ctrlKey || event.metaKey) &&
      !event.shiftKey &&
      !event.altKey &&
      event.key.toLowerCase() === "k" &&
      workspaceShown &&
      conflictBackdropEl.hidden && // the conflict modal must stay the only forward path
      settingsBackdropEl.hidden // don't stack the switcher over an open settings modal
    ) {
      event.preventDefault()
      switcher.open()
    }
  },
  true,
)

// One poll loop, started once a folder is open; `start()` is idempotent, so
// re-picking a folder doesn't double-arm it — the single loop follows whichever
// folder the controller currently holds.
const poller = createPoller(() => controller.refreshFromDisk(), POLL_MS)
const openNote = async (dir: FileSystemDirectoryHandle) => {
  await expandedFoldersReady // first tree paint should match the saved expand state
  await sidebarWidthReady // apply the saved sidebar width before first paint (no flash)
  await recencyReady // load the MRU list before the first visit is recorded (no race)
  // Settings travel with the vault (M16/FEAT-0047): read this folder's
  // `.brulion.json` and apply font/size/width/Vim before its content paints. The
  // `loadingSettings` guard makes a `Ctrl/Cmd+;` during this window a no-op, so the
  // freshly loaded value isn't clobbered and nothing is written to the old folder.
  loadingSettings = true
  settingsDir = dir
  try {
    currentSettings = await loadSettings(dir)
  } finally {
    loadingSettings = false
  }
  applySettings(view, currentSettings)
  settingsModal?.sync() // reflect this folder's settings if the modal is open
  if (!initialRouteConsumed) {
    // First folder open: the URL hash (a bookmark/reload) beats the persisted
    // last-active note (FEAT-0036). Read it before opening, mirror nothing while
    // we resolve, then settle the URL with replaceState so landing leaves exactly
    // one history entry (no phantom previous for Back to step onto).
    initialRouteConsumed = true
    suppressRouteSync = true
    let missing: string | null = null
    try {
      await controller.open(dir)
      // The hash held steady across open() (mirroring is suppressed), so it still
      // names the bookmark; honor it over the persisted active note.
      const resolution = resolveHash()
      if (resolution.kind === "switch") await controller.switchTo(resolution.path)
      else if (resolution.kind === "missing") missing = resolution.path
    } finally {
      suppressRouteSync = false
    }
    if (missing) {
      // The bookmark names a note that's gone: the fallback note is open, but keep
      // the bookmark hash in the bar (it names what the banner offers to create)
      // and surface the banner — don't settle the URL away from it.
      showMissingBanner(missing)
    } else {
      // Settle the URL so landing leaves exactly one history entry (no phantom
      // previous for Back to step onto).
      history.replaceState(null, "", pathToHash(currentActive))
    }
  } else {
    await controller.open(dir)
  }
  poller.start()
}

// URL → open note (FEAT-0036): Back/Forward, the mouse back button, or an edited
// URL fire hashchange. Before a folder is open the hash is inert. Otherwise resolve
// it: switch to a named existing note; raise the missing-note banner for a
// well-formed hash naming an absent note (keeping the hash, which names the note
// the banner offers to create); ignore a malformed hash or one equal to the open
// note (the loop guard — our own mirror writes land here too).
window.addEventListener("hashchange", () => {
  if (!workspaceShown) return
  const resolution = resolveHash()
  if (resolution.kind === "switch") void controller.switchTo(resolution.path)
  else if (resolution.kind === "missing") showMissingBanner(resolution.path)
  else clearMissingBanner() // hash now names the open note (or is malformed) — drop any stale notice
})

// The two ways out of a conflict; the controller clears it via onConflictResolved.
keepButton.addEventListener("click", () => void controller.resolveKeepMine())
diskButton.addEventListener("click", () => void controller.resolveTakeTheirs())

wireOpenFolder(openButton, resumeButton, openNote)
// Re-pick a different folder once one is open (FEAT-0031): same open flow, driven
// from the header (the welcome CTA is hidden behind the workspace by then).
wireOpenFolder(reopenButton, resumeButton, openNote)
// Try to silently re-attach to the last folder, then settle the first-paint
// state: the loading overlay gives way to the workspace (if a folder restored) or
// the welcome screen (if not) — so the welcome never flashes before an
// auto-restored folder loads (FEAT-0031).
void restoreFolder(resumeButton, openNote).finally(() => {
  loadingEl.hidden = true
  if (!workspaceShown) welcomeEl.hidden = false
})

// Sidebar collapse (FEAT-0020): restore the saved preference, wire the header
// toggle, and bind Ctrl+\ to the same flip. CodeMirror has no binding for that
// chord, so the event bubbles to window and never disturbs the editor shortcuts.
void loadSidebarCollapsed().then((collapsed) => {
  // On a narrow viewport the sidebar is a slide-over drawer: always start it closed
  // and don't touch the persisted preference (which stays purely a desktop setting),
  // so the drawer never opens over the editor on a phone load (M17 review).
  const startCollapsed = MOBILE.matches ? true : collapsed
  let isCollapsed = startCollapsed
  const sidebar = wireToggle(toggleSidebarEl, {
    initialOn: startCollapsed,
    apply: (on) => {
      isCollapsed = on
      workspaceEl.classList.toggle("sidebar-collapsed", on)
    },
    onChange: (on) => {
      if (!MOBILE.matches) void saveSidebarCollapsed(on) // narrow drawer state isn't persisted
    },
  })
  // Drawer dismiss (FEAT-0051): collapse only when currently open, so a tap when
  // already closed is inert. Wired to the backdrop and (via dismissDrawerIfMobile)
  // to note-select; both are no-ops on desktop where there is no backdrop.
  const closeDrawer = () => {
    if (!isCollapsed) sidebar.toggle()
  }
  sidebarBackdropEl.addEventListener("click", closeDrawer)
  dismissDrawerIfMobile = () => {
    if (MOBILE.matches) closeDrawer()
  }
  window.addEventListener("keydown", (event) => {
    if (event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey && event.key === "\\") {
      event.preventDefault()
      sidebar.toggle()
    }
  })
})

// Settings modal (FEAT-0048): the visible home for font/size/width/Vim, reading the
// current settings and reporting changes through updateSettings (apply + persist).
settingsModal = mountSettingsModal(settingsBackdropEl, {
  getSettings: () => currentSettings,
  onChange: updateSettings,
  resolveFontChoices,
})
// Two entry points open it: the header gear and `Ctrl/Cmd+,`. The gear replaces the
// old header Vim button (Vim now lives inside the modal).
openSettingsEl.addEventListener("click", () => settingsModal?.open())

// Opt-in Vim mode (FEAT-0021), now backed by the per-vault settings file
// (M16/FEAT-0047) instead of idb, and toggled from inside the settings modal or via
// the `Ctrl/Cmd+;` chord — both flip `settings.vim` through updateSettings, which
// re-applies the editor's Vim compartment in place (no remount) and persists
// `.brulion.json`. The state is restored per folder open (in openNote).
//
// Capture phase + preventDefault so each chord is owned here regardless of
// Vim/CodeMirror key handling; both use `event.code` (layout-proof). `Ctrl/Cmd+;`
// toggles Vim; `Ctrl/Cmd+,` opens settings (unless the switcher is up — don't stack
// modals). Both require a folder open and the conflict modal closed (it must stay
// the only forward path).
window.addEventListener(
  "keydown",
  (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return
    if (!workspaceShown || !conflictBackdropEl.hidden) return
    if (event.code === "Semicolon") {
      event.preventDefault()
      toggleVim()
    } else if (event.code === "Comma" && switcherBackdropEl.hidden) {
      event.preventDefault()
      settingsModal?.open()
    }
  },
  true,
)

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
