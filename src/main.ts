import "./styles.css"
import { mountEditor } from "./editor"
import { createNoteController, type NoteController } from "./note-controller"
import { wireOpenFolder, restoreFolder, renderNoteList, wireNewNote } from "./ui"
import { wireFlushOnHide } from "./flush"

const editorEl = document.querySelector<HTMLDivElement>("#editor")
const sidebarEl = document.querySelector<HTMLElement>("#sidebar")
const listEl = document.querySelector<HTMLElement>("#note-list")
const newNoteForm = document.querySelector<HTMLFormElement>("#new-note")
const newNoteInput = document.querySelector<HTMLInputElement>("#new-note-input")
const openButton = document.querySelector<HTMLButtonElement>("#open-folder")
const resumeButton = document.querySelector<HTMLButtonElement>("#resume-access")
const statusEl = document.querySelector<HTMLParagraphElement>("#status")
if (
  !editorEl ||
  !sidebarEl ||
  !listEl ||
  !newNoteForm ||
  !newNoteInput ||
  !openButton ||
  !resumeButton ||
  !statusEl
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
    statusEl.textContent =
      "This note changed on disk — your edits were not saved, to avoid overwriting it."
    statusEl.hidden = false
  },
  onListChanged: (notes, active) => {
    sidebarEl.hidden = false // a folder is open — reveal the list and new-note control
    renderNoteList(listEl, notes, active, {
      onSelect: (name) => void controller.switchTo(name),
      onDelete: (name) => {
        const display = name.replace(/\.md$/i, "")
        if (window.confirm(`Delete "${display}"? This removes the file from your folder.`)) {
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

const openNote = (dir: FileSystemDirectoryHandle) => controller.open(dir)

wireOpenFolder(openButton, resumeButton, openNote)
void restoreFolder(resumeButton, openNote)

// Flush pending edits before the page can go away.
wireFlushOnHide(() => controller.flush())
