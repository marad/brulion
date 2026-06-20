import type { EditorView } from "codemirror"
import { setEditorText } from "./editor"
import { readNote, saveNote, listNotes } from "./note"
import { saveActiveNote, loadActiveNote } from "./session"
import { debounce } from "./debounce"

const SEED_NOTE = "start.md"

export interface NoteControllerOptions {
  /** Called when a save is refused because the file changed on disk. */
  onConflict?: () => void
  /** Called whenever the note list or the active note changes. */
  onListChanged?: (notes: string[], active: string) => void
  /** Autosave debounce in ms (default 600). */
  debounceMs?: number
}

export interface NoteController {
  /** Bind to a folder: list its notes, pick the active one, and load it. */
  open(dir: FileSystemDirectoryHandle): Promise<void>
  /** Switch the editor to `name`, flushing the open note's edits first. */
  switchTo(name: string): Promise<void>
  /** Note a user edit — schedules a debounced autosave. */
  handleChange(): void
  /** Save any pending changes immediately (focus loss / Ctrl+S). */
  flush(): void
}

/**
 * Choose which note to open in a folder: the persisted active note if it still
 * exists, else `start.md` if present, else the first note, else `start.md`
 * (an empty folder, where `start.md` is seeded lazily on first capture).
 */
export function pickActiveNote(
  names: string[],
  persisted: string | null | undefined,
): string {
  if (persisted && names.includes(persisted)) return persisted
  if (names.includes(SEED_NOTE)) return SEED_NOTE
  return names[0] ?? SEED_NOTE
}

/**
 * Owns the live save state for the active note: which folder, which note, the
 * last-seen `lastModified`, whether there are unsaved edits, and whether we've
 * hit a conflict. Routes debounced autosave, immediate flushes, switching, and
 * the no-silent-clobber guard through one `doSave`.
 */
export function createNoteController(
  view: EditorView,
  opts: NoteControllerOptions = {},
): NoteController {
  let dir: FileSystemDirectoryHandle | null = null
  let activeName = SEED_NOTE
  let notes: string[] = []
  let lastModified: number | null = null
  let dirty = false
  let conflict = false
  let savePromise: Promise<void> | null = null

  // Serialize saves: at most one save loop runs at a time. A concurrent caller
  // (a fired debounce, a flush, a switch) joins the in-flight promise rather
  // than starting a second write. Edits arriving mid-save re-set `dirty`, and
  // the loop picks them up in another pass — so nothing is lost and the file is
  // never written concurrently. Awaiting the returned promise drains all edits
  // that were dirty at resolution time (used by switchTo to flush before load).
  const doSave = (): Promise<void> => {
    if (savePromise) return savePromise
    if (!dir || conflict || !dirty) return Promise.resolve()
    savePromise = (async () => {
      try {
        while (dirty && !conflict) {
          dirty = false // claim the current edits before the await
          const result = await saveNote(dir!, activeName, view.state.doc.toString(), lastModified)
          if (result.status === "conflict") {
            conflict = true // stop saving so we never clobber the on-disk change
            opts.onConflict?.()
            return
          }
          lastModified = result.lastModified
          // A first save can materialize a note that wasn't listed yet (the
          // lazy seed). Surface it in the list.
          if (dir && !notes.includes(activeName)) {
            notes = await listNotes(dir)
            opts.onListChanged?.(notes, activeName)
          }
        }
      } finally {
        savePromise = null
      }
    })()
    return savePromise
  }

  const autosave = debounce(() => void doSave(), opts.debounceMs ?? 600)

  // Cancel the pending debounce and run a save to completion.
  const flushAndWait = (): Promise<void> => {
    autosave.cancel()
    return doSave()
  }

  // Point the editor at `name`: load its content and reset the save state.
  const load = async (folder: FileSystemDirectoryHandle, name: string): Promise<void> => {
    activeName = name
    dirty = false
    conflict = false
    const note = await readNote(folder, name)
    lastModified = note.lastModified
    setEditorText(view, note.content)
  }

  return {
    async open(folder) {
      if (dir) await flushAndWait() // re-picking a folder: don't lose the open note
      dir = folder
      notes = await listNotes(folder)
      const active = pickActiveNote(notes, await loadActiveNote())
      await load(folder, active)
      await saveActiveNote(active)
      opts.onListChanged?.(notes, active)
    },
    async switchTo(name) {
      if (!dir || name === activeName) return
      await flushAndWait() // flush the open note before re-pointing the editor
      await load(dir, name)
      await saveActiveNote(name)
      opts.onListChanged?.(notes, name)
    },
    handleChange() {
      if (conflict) return
      dirty = true
      autosave.trigger()
    },
    flush() {
      void flushAndWait()
    },
  }
}
