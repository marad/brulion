import { mountEditor } from "./editor"
import { createNoteController, type NoteController } from "./note-controller"
import { wireOpenFolder, restoreFolder } from "./ui"
import { wireFlushOnHide } from "./flush"

const editorEl = document.querySelector<HTMLDivElement>("#editor")
const openButton = document.querySelector<HTMLButtonElement>("#open-folder")
const resumeButton = document.querySelector<HTMLButtonElement>("#resume-access")
const fileList = document.querySelector<HTMLUListElement>("#file-list")
const statusEl = document.querySelector<HTMLParagraphElement>("#status")
if (!editorEl || !openButton || !resumeButton || !fileList || !statusEl) {
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
      "start.md changed on disk — your edits were not saved, to avoid overwriting it."
    statusEl.hidden = false
  },
})

const openNote = (dir: FileSystemDirectoryHandle) => controller.open(dir)

wireOpenFolder(openButton, fileList, resumeButton, openNote)
void restoreFolder(fileList, resumeButton, openNote)

// Flush pending edits before the page can go away.
wireFlushOnHide(() => controller.flush())
