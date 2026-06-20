import type { EditorView } from "codemirror"
import { setEditorText } from "./editor"
import { readNote, saveNote, listNotes, createNote, deleteNote, statNote } from "./note"
import { normalizeNoteName } from "./note-name"
import { saveActiveNote, loadActiveNote } from "./session"
import { debounce } from "./debounce"

const SEED_NOTE = "start.md"

/** The outcome of {@link NoteController.addNote}. */
export type AddNoteResult = { ok: true } | { ok: false; reason: string }

/** How the active note changed on disk (relative to what the controller saw). */
export type ActiveDiskState =
  | { kind: "changed"; lastModified: number; dirty: boolean }
  | { kind: "deleted"; dirty: boolean }

/**
 * The result of {@link NoteController.checkDisk}: a classification of what
 * changed on disk since the controller last looked. Detection only — acting on
 * it (refresh / conflict) is FEAT-0014 / FEAT-0015.
 */
export interface DiskCheck {
  /** The current listing iff the folder's `*.md` set changed, else `null`. */
  listChanged: string[] | null
  /** The active note's on-disk change, or `null` if it is unchanged. */
  active: ActiveDiskState | null
}

/**
 * Classify what changed on disk, purely (no FSA, no DOM) — the testable core of
 * {@link NoteController.checkDisk}.
 *
 * - `listChanged`: the current listing when the sorted `*.md` sets differ, else
 *   `null` (both inputs are sorted, so equal sets compare element-wise).
 * - `active`: `deleted` when the active file is absent **and** we had it before
 *   (`knownLastModified !== null`); a never-materialized seed still absent reads
 *   as no change. `changed` when present with a different mtime (including
 *   `null → value`: a file appeared where we had none); else `null`.
 */
export function classifyDiskCheck(args: {
  knownNotes: string[]
  diskNotes: string[]
  knownLastModified: number | null
  diskActiveLastModified: number | null
  dirty: boolean
}): DiskCheck {
  const { knownNotes, diskNotes, knownLastModified, diskActiveLastModified, dirty } = args

  const listChanged = sameNotes(knownNotes, diskNotes) ? null : diskNotes

  let active: ActiveDiskState | null = null
  if (diskActiveLastModified === null) {
    // Absent on disk. Only a change if we had it before; a never-materialized
    // seed that's still absent is not "deleted".
    if (knownLastModified !== null) active = { kind: "deleted", dirty }
  } else if (diskActiveLastModified !== knownLastModified) {
    // Present with a different mtime (incl. null → value: a file appeared).
    active = { kind: "changed", lastModified: diskActiveLastModified, dirty }
  }

  return { listChanged, active }
}

/** Element-wise equality of two pre-sorted listings (see {@link listNotes}). */
function sameNotes(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  return a.every((name, i) => name === b[i])
}

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
  /** Create a note from a user-typed name and open it. Reports why it failed. */
  addNote(name: string): Promise<AddNoteResult>
  /** Delete `name`'s file; if it was active, switch to another note. */
  removeNote(name: string): Promise<void>
  /** Note a user edit — schedules a debounced autosave. */
  handleChange(): void
  /** Save any pending changes immediately (focus loss / Ctrl+S). */
  flush(): void
  /**
   * Compare the folder against what the controller last saw and classify what
   * changed on disk. Detection only — non-destructive (no write, no buffer
   * reload, no state mutation); a no-op with no folder open.
   */
  checkDisk(): Promise<DiskCheck>
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
          if (!notes.includes(activeName)) {
            notes = await listNotes(dir!)
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
    conflict = false
    const note = await readNote(folder, name)
    lastModified = note.lastModified
    setEditorText(view, note.content)
    dirty = false // discard any stray edit typed on the old content during the read
  }

  // Make `name` the active note and announce it. The caller has already flushed
  // (or deliberately dropped) the previously open note's edits.
  const activate = async (folder: FileSystemDirectoryHandle, name: string): Promise<void> => {
    await load(folder, name)
    await saveActiveNote(name)
    opts.onListChanged?.(notes, name)
  }

  // Serialize folder/active-note changes so two fast clicks (open, or switching
  // between rows) can't interleave their loads and leave the editor content,
  // the highlighted row, and `lastModified` pointing at different notes.
  let queue: Promise<unknown> = Promise.resolve()
  const serialize = <T>(op: () => Promise<T>): Promise<T> => {
    const run = queue.then(op, op)
    queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  return {
    open(folder) {
      return serialize(async () => {
        if (dir) await flushAndWait() // re-picking a folder: don't lose the open note
        dir = folder
        notes = await listNotes(folder)
        const active = pickActiveNote(notes, await loadActiveNote())
        await activate(folder, active)
      })
    },
    switchTo(name) {
      return serialize(async () => {
        if (!dir || name === activeName) return
        await flushAndWait() // flush the open note before re-pointing the editor
        await activate(dir, name)
      })
    },
    addNote(name) {
      return serialize<AddNoteResult>(async () => {
        if (!dir) return { ok: false, reason: "Open a folder first." }
        const normalized = normalizeNoteName(name)
        if (!normalized.ok) return { ok: false, reason: normalized.reason }
        const created = await createNote(dir, normalized.filename)
        if (created.status === "exists") {
          return { ok: false, reason: "A note with that name already exists." }
        }
        notes = await listNotes(dir)
        await flushAndWait() // flush the open note before opening the new one
        await activate(dir, normalized.filename)
        return { ok: true }
      })
    },
    removeNote(name) {
      return serialize(async () => {
        if (!dir) return
        // Drop the deleted note's unsaved edits so the flush below won't write
        // them back. Then await flushAndWait regardless: it settles any save
        // already in flight (which would otherwise complete and re-create the
        // file after we delete it) before we remove it — `doSave` runs on its
        // own mutex outside this queue, so cancelling alone can't stop a write
        // already mid-flight.
        if (name === activeName) dirty = false
        await flushAndWait()
        await deleteNote(dir, name)
        notes = await listNotes(dir)
        if (name === activeName) {
          await activate(dir, pickActiveNote(notes, null))
        } else {
          opts.onListChanged?.(notes, activeName)
        }
      })
    },
    handleChange() {
      if (conflict) return
      dirty = true
      autosave.trigger()
    },
    flush() {
      void flushAndWait()
    },
    checkDisk() {
      return serialize<DiskCheck>(async () => {
        const folder = dir
        if (!folder) return { listChanged: null, active: null }
        // Skip while our own save is in flight: doSave runs on its own mutex
        // outside this queue, so mid-save the file's mtime has moved but our
        // `lastModified` hasn't caught up yet — checking now would report our
        // own write as an external change. The next poll (or a manual check)
        // sees a settled, consistent state.
        if (savePromise) return { listChanged: null, active: null }
        // Probe the disk; classify against the controller's current view. No
        // state is adopted here (that would disarm the save-time conflict
        // guard) — detection only. The serialize queue keeps activeName/notes
        // stable across these awaits.
        const diskNotes = await listNotes(folder)
        const diskActiveLastModified = await statNote(folder, activeName)
        return classifyDiskCheck({
          knownNotes: notes,
          diskNotes,
          knownLastModified: lastModified,
          diskActiveLastModified,
          dirty,
        })
      })
    },
  }
}
