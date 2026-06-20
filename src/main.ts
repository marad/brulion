import "./styles.css"
import { mountEditor, setEditorEditable } from "./editor"
import { createNoteController, type NoteController } from "./note-controller"
import { wireOpenFolder, restoreFolder, renderNoteList, wireNewNote } from "./ui"
import { displayName } from "./note-name"
import { wireFlushOnHide } from "./flush"
import { createPoller } from "./watch"

/** How often to poll the folder for changes made by other tools (FEAT-0014). */
const POLL_MS = 2000

const editorEl = document.querySelector<HTMLDivElement>("#editor")
const sidebarEl = document.querySelector<HTMLElement>("#sidebar")
const listEl = document.querySelector<HTMLElement>("#note-list")
const newNoteForm = document.querySelector<HTMLFormElement>("#new-note")
const newNoteInput = document.querySelector<HTMLInputElement>("#new-note-input")
const openButton = document.querySelector<HTMLButtonElement>("#open-folder")
const resumeButton = document.querySelector<HTMLButtonElement>("#resume-access")
const statusEl = document.querySelector<HTMLParagraphElement>("#status")
const conflictBackdropEl = document.querySelector<HTMLDivElement>("#conflict-backdrop")
const keepButton = document.querySelector<HTMLButtonElement>("#conflict-keep")
const diskButton = document.querySelector<HTMLButtonElement>("#conflict-disk")
if (
  !editorEl ||
  !sidebarEl ||
  !listEl ||
  !newNoteForm ||
  !newNoteInput ||
  !openButton ||
  !resumeButton ||
  !statusEl ||
  !conflictBackdropEl ||
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
controller = createNoteController(view, {
  onConflict: () => {
    // Modal: show the choice and lock the editor; navigation is blocked in the
    // controller. The only way forward is one of the two resolution buttons.
    conflictBackdropEl.hidden = false
    setEditorEditable(view, false)
  },
  onConflictResolved: () => {
    conflictBackdropEl.hidden = true
    setEditorEditable(view, true)
  },
  onListChanged: (notes, active) => {
    sidebarEl.hidden = false // a folder is open — reveal the list and new-note control
    renderNoteList(listEl, notes, active, {
      onSelect: (name) => void controller.switchTo(name),
      onDelete: (name) => {
        if (
          window.confirm(`Delete "${displayName(name)}"? This removes the file from your folder.`)
        ) {
          void controller.removeNote(name)
        }
      },
    })
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
  await controller.open(dir)
  poller.start()
}

// The two ways out of a conflict; the controller clears it via onConflictResolved.
keepButton.addEventListener("click", () => void controller.resolveKeepMine())
diskButton.addEventListener("click", () => void controller.resolveTakeTheirs())

wireOpenFolder(openButton, resumeButton, openNote)
void restoreFolder(resumeButton, openNote)

// Flush pending edits before the page can go away.
wireFlushOnHide(() => controller.flush())
