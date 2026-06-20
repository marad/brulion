import type { EditorView } from "codemirror"
import { setEditorText } from "./editor"
import { readNote, saveNote } from "./note"
import { debounce } from "./debounce"

// FEAT-0011 wires the active note; until then the controller stays on `start.md`.
const NOTE_NAME = "start.md"

export interface NoteControllerOptions {
  /** Called when a save is refused because the file changed on disk. */
  onConflict?: () => void
  /** Autosave debounce in ms (default 600). */
  debounceMs?: number
}

export interface NoteController {
  /** Bind to a folder: load `start.md` into the editor (or an empty buffer). */
  open(dir: FileSystemDirectoryHandle): Promise<void>
  /** Note a user edit — schedules a debounced autosave. */
  handleChange(): void
  /** Save any pending changes immediately (focus loss / Ctrl+S). */
  flush(): void
}

/**
 * Owns the live save state for `start.md`: which folder, the last-seen
 * `lastModified`, whether there are unsaved edits, and whether we've hit a
 * conflict. Routes debounced autosave, immediate flushes, and the no-silent-
 * clobber guard through one `doSave`.
 */
export function createNoteController(
  view: EditorView,
  opts: NoteControllerOptions = {},
): NoteController {
  let dir: FileSystemDirectoryHandle | null = null
  let lastModified: number | null = null
  let dirty = false
  let conflict = false
  let saving = false

  // Serialize saves: a `saving` guard means flush() and a fired debounce can
  // never run two writes at once. Edits arriving mid-save re-set `dirty`, and
  // the loop saves them in another pass — so nothing is lost and the file is
  // never written concurrently.
  const doSave = async () => {
    if (saving || !dir || conflict || !dirty) return
    saving = true
    try {
      while (dirty && !conflict) {
        dirty = false // claim the current edits before the await
        const result = await saveNote(dir, NOTE_NAME, view.state.doc.toString(), lastModified)
        if (result.status === "conflict") {
          conflict = true // stop saving so we never clobber the on-disk change
          opts.onConflict?.()
          return
        }
        lastModified = result.lastModified
      }
    } finally {
      saving = false
    }
  }

  const autosave = debounce(() => void doSave(), opts.debounceMs ?? 600)

  return {
    async open(folder) {
      dir = folder
      dirty = false
      conflict = false
      const note = await readNote(folder, NOTE_NAME)
      lastModified = note.lastModified
      setEditorText(view, note.content)
    },
    handleChange() {
      if (conflict) return
      dirty = true
      autosave.trigger()
    },
    flush() {
      autosave.cancel()
      void doSave()
    },
  }
}
