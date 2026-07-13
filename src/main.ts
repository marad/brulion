import "./styles.css"
import { trackSync } from "./perf"
import {
  createElement,
  Settings as SettingsIcon,
  PanelLeft,
  Search,
  FolderOpen,
  Folders,
  Keyboard,
  Command,
  CalendarDays,
  SunMoon,
  type IconNode,
} from "lucide"
import { mountEditor, setEditorEditable, setLinkContext, scrollEditorToHeading } from "./editor"
import { listFolders } from "./note"
import { createNoteController, type NoteController } from "./note-controller"
import { mountConflictDiff, type ConflictDiff } from "./conflict-view"
import {
  wireOpenFolder,
  openFolder,
  restoreVault,
  renderNoteList,
  derivedFolderPaths,
  renderActionBar,
  wireToggle,
  wireSidebarResize,
  showWorkspace,
  mountNoteIdentity,
  mountMissingNoteBanner,
  markMotionReady,
  type NoteIdentityHandle,
} from "./ui"
import { mountQuickSwitcher } from "./quick-switcher"
import { mountCommandPalette } from "./command-palette"
import { mountMovePicker } from "./move-picker"
import { resolvePinned, type Action } from "./actions"
import {
  addVault,
  getVault,
  touchVault,
  listVaults,
  removeVault,
  migrateLegacyFolder,
  type Vault,
} from "./vaults"
import {
  saveSidebarCollapsed,
  loadSidebarCollapsed,
  saveExpandedFolders,
  loadExpandedFolders,
  saveSidebarWidth,
  loadSidebarWidth,
  saveRecency,
  loadRecency,
  saveNoteList,
  loadNoteList,
  migrateLegacySession,
  hasPermission,
  requestAccess,
} from "./session"
import {
  loadSettings,
  saveSettings,
  applySettings,
  nextToggledTheme,
  DEFAULT_SETTINGS,
  type Settings,
} from "./settings"
import { mountSettingsModal, type SettingsModalHandle } from "./settings-modal"
import { resolveFontChoices } from "./font-access"
import { touchRecency } from "./note-search"
import { displayName, isExternalLink, resolveNotePath, normalizeNoteName } from "./note-name"
import { expandJournalPath } from "./journal"
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
/** Toggle the note-list sidebar — assigned once the sidebar toggle is wired (it
 * lives inside an async restore callback). A no-op before then. Used by the
 * "Toggle note list" command-palette action (FEAT-0057). */
let toggleNoteList = (): void => {}
/** Repaint the header action bar from the current settings — assigned once the
 * action registry exists. A no-op before then. Called on folder open and after any
 * settings change (FEAT-0058). */
let refreshActionBar = (): void => {}

// Enable chrome motion (FEAT-0068) only after the first paint has settled, so the
// load sequence and the async theme apply never animate (no welcome/theme flash).
markMotionReady()

const editorEl = document.querySelector<HTMLDivElement>("#editor")
const workspaceEl = document.querySelector<HTMLElement>(".workspace")
const loadingEl = document.querySelector<HTMLElement>("#loading")
const welcomeEl = document.querySelector<HTMLElement>("#welcome")
const sidebarEl = document.querySelector<HTMLElement>("#sidebar")
const toggleSidebarEl = document.querySelector<HTMLButtonElement>("#toggle-sidebar")
const sidebarResizerEl = document.querySelector<HTMLElement>("#sidebar-resizer")
const sidebarBackdropEl = document.querySelector<HTMLElement>("#sidebar-backdrop")
const openSettingsEl = document.querySelector<HTMLButtonElement>("#open-settings")
const actionBarEl = document.querySelector<HTMLElement>("#action-bar")
const settingsBackdropEl = document.querySelector<HTMLElement>("#settings-backdrop")
const noteIdentityEl = document.querySelector<HTMLElement>("#note-identity")
const missingNoteEl = document.querySelector<HTMLElement>("#missing-note")
const listEl = document.querySelector<HTMLElement>("#note-list")
const sidebarSearchEl = document.querySelector<HTMLButtonElement>("#sidebar-search")
const sidebarNewFolderEl = document.querySelector<HTMLButtonElement>("#sidebar-new-folder")
const switcherBackdropEl = document.querySelector<HTMLDivElement>("#switcher-backdrop")
const switcherInputEl = document.querySelector<HTMLInputElement>("#switcher-input")
const switcherListEl = document.querySelector<HTMLElement>("#switcher-list")
const switcherErrorEl = document.querySelector<HTMLElement>("#switcher-error")
const paletteBackdropEl = document.querySelector<HTMLDivElement>("#palette-backdrop")
const paletteInputEl = document.querySelector<HTMLInputElement>("#palette-input")
const paletteListEl = document.querySelector<HTMLElement>("#palette-list")
const moveBackdropEl = document.querySelector<HTMLDivElement>("#move-backdrop")
const moveInputEl = document.querySelector<HTMLInputElement>("#move-input")
const moveListEl = document.querySelector<HTMLElement>("#move-list")
const moveErrorEl = document.querySelector<HTMLElement>("#move-error")
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
  !actionBarEl ||
  !settingsBackdropEl ||
  !noteIdentityEl ||
  !missingNoteEl ||
  !listEl ||
  !sidebarSearchEl ||
  !sidebarNewFolderEl ||
  !moveBackdropEl ||
  !moveInputEl ||
  !moveListEl ||
  !moveErrorEl ||
  !switcherBackdropEl ||
  !switcherInputEl ||
  !switcherListEl ||
  !switcherErrorEl ||
  !paletteBackdropEl ||
  !paletteInputEl ||
  !paletteListEl ||
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

// Header icons from Lucide (FEAT-0055): one source for size + look, tree-shaken to
// just these icons. The class is the CSS sizing hook (`.header-icon`) and lets the
// icons inherit the header text color via the default `currentColor` stroke.
const headerIcon = (node: IconNode) =>
  createElement(node, { class: "header-icon", "aria-hidden": "true" })
toggleSidebarEl.replaceChildren(headerIcon(PanelLeft))
openSettingsEl.replaceChildren(headerIcon(SettingsIcon))

// The editor needs the controller and the controller needs the view; the
// callbacks only fire on user interaction, after both are assigned.
let controller: NoteController
// The open note and the known note paths, tracked from onListChanged so a link
// follow (FEAT-0025) can resolve relative to the open note and tell an existing
// target from one to offer to create.
let currentActive = ""
let currentNotes: string[] = []
// Folders with no notes in them (M35/FEAT-0069) — not covered by currentNotes
// at all (an empty folder implies no note path), so tracked separately.
// Refreshed once per vault attach (openNote) and whenever addFolder/
// removeFolder actually change the set (onFoldersChanged); NOT on every
// ordinary note change, which never affects folder existence — a per-note-op
// directory walk would undermine the Sweep/budget work done elsewhere to
// bound relist cost on large vaults.
let currentFolders: string[] = []
// The vault the window is attached to (M33/FEAT-0059); the key for per-vault session
// (recency, expanded folders) and the value stamped into `?ws`. Empty until the first
// attach.
let currentVaultId = ""
// The most-recently-visited note list (FEAT-0039), most-recent first — now per-vault
// (M33): loaded for the attached vault in attachVault, touched on every genuine
// active-note change and persisted under the vault's key.
let recency: string[] = []
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
// Follow a resolved internal note path, optionally jumping to a section anchor
// (FEAT-0061). Same note → just scroll to the heading; another existing note →
// switch then scroll once it's loaded; a missing note → offer to create (the anchor
// is moot, the new note has no heading).
const openNotePath = (path: string, anchor: string | null = null) => {
  if (path === currentActive) {
    if (anchor) scrollEditorToHeading(view, anchor)
  } else if (currentNotes.includes(path)) {
    void controller.switchTo(path).then(() => {
      if (anchor) scrollEditorToHeading(view, anchor)
    })
  } else if (window.confirm(`"${displayName(path)}" doesn't exist yet. Create it?`)) {
    void controller.addNote(path)
  }
}
const view = mountEditor(editorEl, {
  onChange: () => controller.handleChange(),
  onSave: () => controller.flush(),
  onFollowLink: (href, anchor) => {
    if (isExternalLink(href)) {
      // Open in a new tab via a real anchor click — `window.open(_, _, "noopener")`
      // opens a popup window (not a tab) in some browsers (FEAT-0026).
      const link = document.createElement("a")
      link.href = href
      link.target = "_blank"
      link.rel = "noopener noreferrer"
      link.click()
      return
    }
    if (href === "") {
      // A same-note anchor `[text](#section)` — no note to resolve, just jump.
      if (anchor) scrollEditorToHeading(view, anchor)
      return
    }
    const target = resolveNotePath(currentActive, href)
    if (target) openNotePath(target, anchor) // null = escapes the root / not a note — inert
  },
  // A wikilink (FEAT-0027) already carries its resolved absolute note path.
  onFollowNote: (path, anchor) => openNotePath(path, anchor),
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
  refreshActionBar() // a changed actionBar (or any setting) repaints the header bar
  settingsModal?.sync()
  void persistSettings()
}
const toggleVim = () => {
  if (loadingSettings) return // mid folder-open: ignore, the loaded value wins
  updateSettings({ vim: !currentSettings.vim })
}
const toggleTheme = () => {
  if (loadingSettings) return // mid folder-open: ignore, the loaded value wins
  const osPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches
  updateSettings({ theme: nextToggledTheme(currentSettings.theme, osPrefersDark) })
}

// The diff view shown while a conflict stands (FEAT-0022); null when none does.
let conflictDiff: ConflictDiff | null = null
// The folders the user expanded (FEAT-0043); every other folder renders collapsed by
// default. Now per-vault (M33): loaded for the attached vault in attachVault before
// the tree's first paint, so it matches the saved state instead of flashing fully
// collapsed.
let expandedFolders = new Set<string>()
// This vault's last-known complete note list (session.ts), loaded in attachVault
// before the first paint — a paint hint only, used to render a plausible sidebar
// immediately on attach (see onPreviewReady) instead of an empty or stale one while
// the real listing is still in flight. Never treated as authoritative: the real
// onListChanged below always supersedes it, whether it lands complete or partial.
let cachedNoteList: string[] = []
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
// Shared row handlers for every renderNoteList call (the real onListChanged render
// and the cache-paint hint in onPreviewReady below) — kept in one place so both
// stay in sync.
const noteListHandlers = {
  onSelect: (name: string) => {
    void controller.switchTo(name)
    dismissDrawerIfMobile() // narrow layout: close the drawer to reveal the note (FEAT-0051)
  },
  onDelete: (name: string) => {
    if (window.confirm(`Delete "${displayName(name)}"? This removes the file from your folder.`)) {
      void controller.removeNote(name)
    }
  },
  onToggleFolder: (path: string, collapsed: boolean) => {
    // The persisted set holds expanded folders (FEAT-0043), so invert:
    // collapsing drops the path, expanding adds it.
    if (collapsed) expandedFolders.delete(path)
    else expandedFolders.add(path)
    void saveExpandedFolders(currentVaultId, expandedFolders)
  },
  onCreateFolder: (parentPath: string) => promptNewFolder(parentPath),
  onDeleteFolder: (path: string) => {
    if (window.confirm(`Delete "${path}" and everything inside it? This removes every note beneath it from your folder.`)) {
      void controller.removeFolder(path)
    }
  },
  onMoveNote: (path: string) => {
    // renameActive is active-note-scoped — switch to this note first, exactly
    // like clicking its name already does, then let the picker apply the move.
    void controller.switchTo(path).then(() => {
      const name = displayName(path).split("/").pop() as string
      movePicker.open(destinationChoices(), (dest) => controller.renameActive(dest ? `${dest}/${name}` : name))
    })
  },
  onMoveFolder: (path: string) => {
    const name = path.split("/").pop() as string
    movePicker.open(destinationChoices(), (dest) =>
      controller.moveFolder(path, dest ? `${dest}/${name}` : name),
    )
  },
}

/** Prompt for a new folder's name and create it under `parentPath` ("" = the
 * vault root) — M35/FEAT-0069. Native `prompt`/`alert`, matching the pattern
 * note delete already uses (`window.confirm` above); no new modal. */
function promptNewFolder(parentPath: string): void {
  const name = window.prompt("New folder name:")
  if (!name) return // dismissed or empty — no-op
  const path = parentPath ? `${parentPath}/${name}` : name
  void controller.addFolder(path).then((result) => {
    if (!result.ok) window.alert(result.reason)
  })
}
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
  onPreviewReady: (path) => {
    // The guessed active note's content is already showing (see
    // note-controller.ts) — on a large vault the full listing behind it can
    // still take several seconds, and none of that gates *this*. Reveal the
    // workspace now instead of holding the loading screen over an
    // already-known answer.
    //
    // Paint the sidebar from this vault's last-known list (session.ts) rather
    // than leaving it empty (first load) or showing the *previous* vault's
    // list (a switch) for however long the real listing takes — a paint hint
    // only, always superseded by the real onListChanged below once the fresh
    // listing (complete or partial) lands. Runs on every attach, not just
    // first paint, since a vault switch has the same stale-sidebar problem.
    if (cachedNoteList.length > 0) {
      // currentFolders is already this vault's real (not cached) listing by
      // this point — openNote fetches it before controller.open() runs.
      trackSync("renderNoteList (cache)", () =>
        renderNoteList(listEl, cachedNoteList, path, noteListHandlers, expandedFolders, currentFolders),
      )
    }
    if (workspaceShown) return // already showing (e.g. this is a vault switch, not first paint)
    workspaceShown = true
    loadingEl.hidden = true
    showWorkspace({
      welcome: welcomeEl,
      sidebar: sidebarEl,
      toggleSidebar: toggleSidebarEl,
      settings: openSettingsEl,
      identity: noteIdentityEl,
      resizer: sidebarResizerEl,
      actionBar: actionBarEl,
    })
    identity.update(path)
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
      identity: noteIdentityEl,
      resizer: sidebarResizerEl,
      actionBar: actionBarEl,
    })
    // Feed the editor the open note + known paths so links render valid-vs-broken
    // and a follow resolves relative to the right note (FEAT-0025).
    currentActive = active
    const listUnchanged = notes === currentNotes
    currentNotes = notes
    // Record the visit (FEAT-0039) on a genuine active-note change only — skip the
    // redundant re-touch when an external list change fires with the same active.
    if (active && recency[0] !== active) {
      recency = touchRecency(recency, active)
      void saveRecency(currentVaultId, recency)
    }
    clearMissingBanner() // the active note changed — drop any stale missing-note notice
    syncRouteToActive(active) // mirror the open note into the URL hash (FEAT-0036)
    identity.update(active) // keep the header naming the open note (FEAT-0035)
    trackSync("setLinkContext", () => setLinkContext(view, { activeNote: active, notePaths: new Set(notes) }))
    if (listUnchanged) {
      // List unchanged — only active note changed. Toggle the highlighted row
      // instead of tearing down and rebuilding the entire sidebar DOM.
      for (const row of listEl.querySelectorAll<HTMLElement>(".note-row")) {
        const isActive = row.dataset.path === active
        row.classList.toggle("active", isActive)
        row.toggleAttribute("aria-current", isActive)
      }
    } else {
      // currentFolders (M35/FEAT-0069): refreshed on vault attach and by
      // onFoldersChanged below, not re-fetched here — an ordinary note change
      // never affects folder existence.
      trackSync("renderNoteList", () =>
        renderNoteList(listEl, notes, active, noteListHandlers, expandedFolders, currentFolders),
      )
      cachedNoteList = notes
      void saveNoteList(currentVaultId, notes) // the fresh, authoritative list — this vault's next attach paints from it
    }
  },
  onFoldersChanged: (folders) => {
    // Fired only by addFolder/removeFolder (M35/FEAT-0069) — a real folder-set
    // change, re-rendered against the note list/active note already in hand.
    currentFolders = folders
    trackSync("renderNoteList", () =>
      renderNoteList(listEl, currentNotes, currentActive, noteListHandlers, expandedFolders, currentFolders),
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

// "Move to…" destination picker (M35/FEAT-0070). Moving a note switches to it
// first (renameActive is active-note-scoped, same constraint the header
// rename already has); moving a folder has no such constraint.
const movePicker = mountMovePicker({
  backdrop: moveBackdropEl,
  input: moveInputEl,
  list: moveListEl,
  error: moveErrorEl,
})

function destinationChoices(): string[] {
  return ["", ...derivedFolderPaths(currentNotes, currentFolders)]
}

// The sidebar's visible entry point into the switcher (creation is no longer a
// textbox), and the Ctrl/Cmd+K shortcut. The shortcut is a capture-phase listener
// so neither CodeMirror nor the Vim layer can swallow it first (AC-9).
sidebarSearchEl.addEventListener("click", () => switcher.open())
// Root-level "new folder" (M35/FEAT-0069) — same prompt/create path as a
// folder row's own "+", just with no parent (creates at the vault root).
sidebarNewFolderEl.addEventListener("click", () => promptNewFolder(""))
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
      settingsBackdropEl.hidden && // don't stack the switcher over an open settings modal
      paletteBackdropEl.hidden // …nor over an open command palette (FEAT-0057)
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
  await sidebarWidthReady // apply the saved sidebar width before first paint (no flash)
  // (Per-vault recency + expanded folders are loaded in attachVault before openNote.)
  // Settings travel with the vault (M16/FEAT-0047): read this folder's
  // `.brulion.json` and apply font/size/width/Vim before its content paints. The
  // `loadingSettings` guard makes a `Ctrl/Cmd+;` during this window a no-op, so the
  // freshly loaded value isn't clobbered and nothing is written to the old folder.
  loadingSettings = true
  settingsDir = dir
  try {
    // Independent reads — run together so a vault with many empty folders
    // doesn't add its listFolders latency on top of the settings read.
    ;[currentSettings, currentFolders] = await Promise.all([loadSettings(dir), listFolders(dir)])
  } finally {
    loadingSettings = false
  }
  applySettings(view, currentSettings)
  refreshActionBar() // paint this folder's pinned action bar (FEAT-0058)
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

// Vault identity in the URL (M33/FEAT-0059): mirror the attached vault's id into
// `?ws=` with replaceState (never a push — that history belongs to note navigation,
// FEAT-0036), preserving the path and the `#/note` hash.
const stampWorkspace = (id: string) => {
  const url = new URL(location.href)
  if (url.searchParams.get("ws") === id) return // already stamped — no redundant entry
  url.searchParams.set("ws", id)
  // Preserve the note hash byte-for-byte (don't let URL re-encode the fragment) —
  // only the query changes; the note route (FEAT-0036) owns the hash.
  history.replaceState(history.state, "", `${url.pathname}${url.search}${location.hash}`)
}
// Drop the `?ws` stamp (the inverse of {@link stampWorkspace}). Used when an attach
// fails so a reload doesn't keep re-resolving to a vault we couldn't open.
const unstampWorkspace = () => {
  const url = new URL(location.href)
  if (!url.searchParams.has("ws")) return
  url.searchParams.delete("ws")
  history.replaceState(history.state, "", `${url.pathname}${url.search}${location.hash}`)
}
// Attach the window to a vault: stamp its `?ws`, load that vault's per-vault session
// (recency + expanded folders), then open it through the existing note flow. The
// vault is moved to most-recent so a future no-`?ws` window falls back to it.
// Serialize attaches: attachVault mutates module globals (currentVaultId, recency,
// expandedFolders) across awaits, so two overlapping attaches — a fast double
// "switch workspace", or a switch fired during the startup restore — would interleave
// and persist one vault's recency under the other's id. Chaining makes each attach
// run to completion before the next begins.
let attachChain: Promise<void> = Promise.resolve()
const attachVault = (vault: Vault): Promise<void> => {
  const run = () => attachVaultNow(vault)
  attachChain = attachChain.then(run, run) // run next even if the prior attach rejected
  return attachChain
}
const attachVaultNow = async (vault: Vault) => {
  // Snapshot the currently attached vault so a failed attach can fall back to it
  // instead of leaving the window pinned to a vault it couldn't open. Includes the
  // settings state openNote mutates (settingsDir/currentSettings) — those are applied
  // to the editor *before* controller.open can throw, so the rollback must restore
  // them too, or a failed switch would leave default settings applied and route the
  // next settings write to the dead folder.
  const prev = {
    vaultId: currentVaultId,
    recency,
    expandedFolders,
    cachedNoteList,
    settingsDir,
    currentSettings,
  }
  // Load the vault's session first, so a transient idb error can't leave `?ws` +
  // currentVaultId pointing at a vault we never actually opened.
  recency = await loadRecency(vault.id)
  expandedFolders = await loadExpandedFolders(vault.id)
  cachedNoteList = await loadNoteList(vault.id)
  currentVaultId = vault.id
  stampWorkspace(vault.id)
  try {
    await openNote(vault.handle)
  } catch (err) {
    // The vault's folder is unreachable (deleted/moved on disk). Roll the window
    // back to the previously attached vault — without this, `?ws` + currentVaultId
    // stay pinned to the dead vault and every reload re-resolves to it and fails
    // again (controller.open keeps the prior folder intact on its side). The vault
    // is left in the set so it can be re-granted if the folder returns.
    currentVaultId = prev.vaultId
    recency = prev.recency
    expandedFolders = prev.expandedFolders
    cachedNoteList = prev.cachedNoteList
    settingsDir = prev.settingsDir
    currentSettings = prev.currentSettings
    applySettings(view, currentSettings) // undo the dead folder's settings applied in openNote
    refreshActionBar()
    settingsModal?.sync()
    if (prev.vaultId) stampWorkspace(prev.vaultId)
    else unstampWorkspace()
    console.error("Failed to attach vault:", err)
    throw err
  }
  await touchVault(vault.id)
}
// A freshly-picked folder (open-folder button / settings switch): record it as a
// vault (reusing an existing one if it's the same folder) and attach to it.
const openFreshFolder = async (dir: FileSystemDirectoryHandle) => {
  await attachVault(await addVault(dir))
}
// Switch the window to an already-granted vault (FEAT-0060): re-grant permission if
// the handle lost it (the click is a user gesture), then attach. Declined → no-op.
const switchToVault = async (vault: Vault) => {
  if (!(await hasPermission(vault.handle)) && !(await requestAccess(vault.handle))) return
  // attachVault rolls back to the previous vault and logs on failure (e.g. the
  // folder is gone); swallow here so the `void switchToVault(...)` call sites don't
  // raise an unhandled rejection.
  await attachVault(vault).catch(() => {})
}
// Open this week's journal (M31/FEAT-0062): expand the configured `journalPath`
// template against today, normalize to a note path, and open it through the existing
// open-note path (switch if it exists, else the create-on-miss prompt). When the
// path is unset (or expands to something invalid), open settings so it can be fixed.
const openWeeklyJournal = () => {
  if (!currentSettings.journalPath) {
    settingsModal?.open()
    return
  }
  const norm = normalizeNoteName(expandJournalPath(currentSettings.journalPath, new Date()))
  if (norm.ok) openNotePath(norm.filename)
  else settingsModal?.open()
}
// The workspace switcher (FEAT-0060): open the command palette with a transient list
// of the *other* granted vaults (omit the open one), each row switching to it.
const openWorkspaceSwitcher = async () => {
  const others = (await listVaults()).filter((v) => v.id !== currentVaultId)
  // With no other workspace, show a guiding non-action instead of a blank dead-end.
  palette.open(
    others.length
      ? others.map((v) => ({ id: `ws:${v.id}`, label: v.name, icon: Folders, run: () => void switchToVault(v) }))
      : [{ id: "ws-none", label: "No other workspaces — add one with “Switch folder…”", run: () => {} }],
  )
}
// Which vault this window should open on load: its `?ws` vault if that id is known,
// else the most-recently-used vault (the set is most-recent-first), else none.
const resolveStartupVault = async (): Promise<Vault | undefined> => {
  const ws = new URLSearchParams(location.search).get("ws")
  if (ws) {
    const v = await getVault(ws)
    if (v) return v
  }
  return (await listVaults())[0]
}

wireOpenFolder(openButton, resumeButton, openFreshFolder)
// Re-picking a different folder once one is open (FEAT-0031) now lives in the
// settings modal's Folder section (FEAT-0054), wired below via onSwitchFolder.
// On load: migrate a pre-M33 single handle into the vault set (once), resolve this
// window's vault (its `?ws`, else the most-recent), and re-attach to it — then settle
// the first-paint state (loading → workspace if a vault attached, else welcome). So
// two windows each restore their own `?ws` vault, not a shared global handle.
void (async () => {
  const migrated = await migrateLegacyFolder()
  if (migrated) await migrateLegacySession(migrated.id)
  const vault = await resolveStartupVault()
  if (vault) await restoreVault(vault, resumeButton, attachVault)
})().finally(() => {
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
  toggleNoteList = () => sidebar.toggle() // expose to the command palette (FEAT-0057)
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
  // The open folder's name for the modal's Folder section, and the switch action —
  // the same open flow the old header button drove (FEAT-0054).
  getFolderName: () => settingsDir?.name ?? "",
  onSwitchFolder: () => void openFolder(resumeButton, openFreshFolder),
  // The registry's id/label for the Action bar section (FEAT-0058).
  getActions: () => actions.map((a) => ({ id: a.id, label: a.label })),
  // The granted workspaces for the Workspaces section (FEAT-0060); the open one is
  // marked so it can't be forgotten.
  getWorkspaces: async () =>
    (await listVaults()).map((v) => ({ id: v.id, name: v.name, open: v.id === currentVaultId })),
  onForgetWorkspace: (id: string) => removeVault(id),
})
// Two entry points open it: the header gear and `Ctrl/Cmd+,`. The gear replaces the
// old header Vim button (Vim now lives inside the modal).
openSettingsEl.addEventListener("click", () => settingsModal?.open())

// Action registry + command palette (FEAT-0057/M30 P1). Actions are the app's
// invocable capabilities named as first-class `{ id, label, icon?, run }` records;
// the palette lists them for fuzzy-search + run, and folder-switch / Vim toggle
// thereby "migrate onto the action model" (their existing entry points keep working
// and now share the same `run`). The `run` closures reference live host state, so
// the registry must live here (the only place that has the switcher handle, the
// open-folder flow, toggleVim, the sidebar toggle, and the settings modal in scope).
// Icons come from the M27 Lucide set; the palette sizes them via `.palette-icon`.
const actions: Action[] = [
  { id: "goto", label: "Go to note…", icon: Search, run: () => switcher.open() },
  {
    id: "switch-folder",
    label: "Switch folder…",
    icon: FolderOpen,
    run: () => void openFolder(resumeButton, openFreshFolder),
  },
  { id: "toggle-vim", label: "Toggle Vim mode", icon: Keyboard, run: toggleVim },
  { id: "toggle-theme", label: "Toggle light/dark theme", icon: SunMoon, run: toggleTheme },
  // `toggleNoteList` is a reassigned `let` (the real sidebar handle exists only inside
  // the async restore callback), so wrap the call — passing it bare would freeze the
  // no-op stub at registry-build time. (toggleVim above is a const, so it's safe bare.)
  { id: "toggle-note-list", label: "Toggle note list", icon: PanelLeft, run: () => toggleNoteList() },
  { id: "open-settings", label: "Open settings", icon: SettingsIcon, run: () => settingsModal?.open() },
  { id: "switch-workspace", label: "Switch workspace…", icon: Folders, run: () => void openWorkspaceSwitcher() },
  { id: "open-journal", label: "Open this week's journal", icon: CalendarDays, run: openWeeklyJournal },
  // Opens the palette itself — its value is being pinnable to the action bar and
  // tappable on mobile (no Ctrl/Cmd+Shift+K there). Running it from within the
  // palette just reopens it (harmless).
  { id: "open-palette", label: "Open command palette", icon: Command, run: () => palette.open() },
]
const palette = mountCommandPalette(
  { backdrop: paletteBackdropEl, input: paletteInputEl, list: paletteListEl },
  { getActions: () => actions },
)
// The header action bar (FEAT-0058) renders the pinned actions (settings.actionBar),
// resolved against the registry so an unknown/stale id is silently skipped. Painted
// now (covers the case where a folder restored before this point) and on every
// settings change / folder open via the forward-declared refreshActionBar.
refreshActionBar = () => renderActionBar(actionBarEl, resolvePinned(currentSettings.actionBar, actions))
refreshActionBar()
// `Ctrl/Cmd+Shift+K` opens the palette — grouped with the note switcher's
// `Ctrl/Cmd+K` (K = find a note, Shift+K = run a command), and unlike `Ctrl/Cmd+P`
// it carries no print-dialog risk if Shift is missed. The switcher's own handler
// requires `!shiftKey`, so the two don't collide. Capture-phase + `event.code` so
// neither CodeMirror nor the Vim layer swallows it and it's layout-proof. Gated like
// the other shortcuts: a folder must be open, the conflict modal must be the only
// forward path, and we never stack over another open modal (switcher/settings).
window.addEventListener(
  "keydown",
  (event) => {
    if (
      (event.ctrlKey || event.metaKey) &&
      event.shiftKey &&
      !event.altKey &&
      event.code === "KeyK" &&
      workspaceShown &&
      conflictBackdropEl.hidden &&
      switcherBackdropEl.hidden &&
      settingsBackdropEl.hidden &&
      !palette.isOpen()
    ) {
      event.preventDefault()
      palette.open()
    }
  },
  true,
)

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
    // Don't fire these chords behind an open modal: the conflict modal must stay the
    // only forward path, and the command palette (FEAT-0057) is modal too.
    if (!workspaceShown || !conflictBackdropEl.hidden || !paletteBackdropEl.hidden) return
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
