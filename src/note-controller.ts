import type { EditorView } from "codemirror"
import { setEditorText, reloadEditorText } from "./editor"
import { readNote, saveNote, listNotes, createNote, deleteNote, statNote, moveNote } from "./note"
import { track, trackSync, mark } from "./perf"
import { normalizeNoteName } from "./note-name"
import { rewriteLinksForRename, rebaseOutboundLinks } from "./link-rewrite"
import { saveActiveNote, loadActiveNote } from "./session"
import { debounce } from "./debounce"

const SEED_NOTE = "start.md"

/**
 * How often {@link NoteController.checkDisk}/`refreshFromDisk` actually re-walk the
 * whole tree (FEAT-0014's external add/remove detection), vs. every poll tick (2s):
 * a full recursive `listNotes` is real work — proportional to vault size — while the
 * active note's own mtime (checked every tick regardless, see `probeDisk`) is one
 * cheap file stat. Detecting a file added/removed *elsewhere* by another tool can
 * afford to lag; silently clobbering the note you're actively editing cannot, so
 * that guarantee stays at the full 2s cadence.
 */
const FULL_RELIST_MS = 15_000

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

/** The folder portion of a note path (`""` for a root-level note) — used to tell a
 * pure rename (same folder) from a move that crosses folders. */
function folderOf(path: string): string {
  const slash = path.lastIndexOf("/")
  return slash === -1 ? "" : path.slice(0, slash)
}

/** Element-wise equality of two pre-sorted listings (see {@link listNotes}). */
function sameNotes(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  return a.every((name, i) => name === b[i])
}

/**
 * The two versions surfaced when a conflict is raised, so the UI can diff them
 * (FEAT-0022): the unsaved buffer (`mine`) and the on-disk content (`theirs`),
 * read fresh at raise time. `theirs` is `null` when the file was deleted on disk.
 */
export interface ConflictVersions {
  mine: string
  theirs: string | null
}

export interface NoteControllerOptions {
  /** Called when the open note changed on disk under unsaved edits (conflict). */
  onConflict?: (versions: ConflictVersions) => void
  /** Called when a standing conflict is resolved (either way) — clears the UI. */
  onConflictResolved?: () => void
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
  /**
   * Rename the active note to a user-typed `name` (FEAT-0034): flush pending
   * edits, move its file via {@link moveNote}, then follow the file to its new
   * path (new active note, refreshed list, announced). Reports `{ ok }` /
   * `{ ok: false, reason }`; refuses without moving anything on no folder, a
   * standing conflict, an invalid name, or an occupied destination. After the
   * move, silently rewrites inbound links in *other* notes so they follow it
   * (FEAT-0040), each written through the per-note stale-write guard.
   */
  renameActive(name: string): Promise<AddNoteResult>
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
  /**
   * Reflect the disk for the non-conflicting cases: refresh the list, and (only
   * when there are no unsaved local edits) reload the open note's external edit
   * or switch off it if it was deleted. A no-op with no folder open or while a
   * save is in flight. A collision with unsaved edits instead surfaces a
   * conflict (see {@link resolveKeepMine} / {@link resolveTakeTheirs}).
   */
  refreshFromDisk(): Promise<void>
  /**
   * Resolve a standing conflict by keeping the buffer: overwrite the on-disk
   * file with the editor's content (re-creating it if it was deleted). Clears
   * the conflict. A no-op when there is no conflict.
   */
  resolveKeepMine(): Promise<void>
  /**
   * Resolve a standing conflict by taking the disk: discard local edits and
   * load the on-disk content, or switch off the note if it was deleted. Clears
   * the conflict. A no-op when there is no conflict.
   */
  resolveTakeTheirs(): Promise<void>
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
  // ponytail: in-memory cache keyed by path; stale-write guard still catches external edits on save
  const contentCache = new Map<string, { content: string; lastModified: number | null }>()
  // The last time probeDisk actually re-walked the whole tree (see FULL_RELIST_MS
  // below). -Infinity forces a relist on the first poll after each open(), so a
  // freshly attached folder's list is always verified once before throttling kicks in.
  let lastFullListAt = -Infinity

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
            await raiseConflict() // the reactive path into the one conflict state
            return
          }
          lastModified = result.lastModified
          contentCache.set(activeName, { content: view.state.doc.toString(), lastModified: result.lastModified })
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
  // Re-pointing the editor also resolves any standing conflict (the conflicted
  // buffer is left behind — an implicit "take theirs" when the user navigates
  // away instead of choosing), so tell the UI to drop the banner.
  const load = async (folder: FileSystemDirectoryHandle, name: string): Promise<void> => {
    activeName = name
    if (conflict) {
      conflict = false
      opts.onConflictResolved?.()
    }
    const cached = contentCache.get(name)
    if (cached) mark(`cache hit: ${name}`)
    const note = cached ?? await track(`readNote: ${name}`, () => readNote(folder, name))
    if (!cached) contentCache.set(name, note)
    lastModified = note.lastModified
    trackSync("setEditorText", () => setEditorText(view, note.content))
    dirty = false // discard any stray edit typed on the old content during the read
  }

  // Make `name` the active note and announce it. The caller has already flushed
  // (or deliberately dropped) the previously open note's edits.
  const activate = async (folder: FileSystemDirectoryHandle, name: string): Promise<void> => {
    await load(folder, name)
    await saveActiveNote(name)
    opts.onListChanged?.(notes, name)
  }

  // Probe the disk and classify it against the controller's current view. No
  // state is adopted — detection only. Callers run this inside a serialize slot
  // so `notes`/`activeName`/`lastModified` stay stable across its awaits.
  const probeDisk = async (folder: FileSystemDirectoryHandle): Promise<DiskCheck> => {
    const now = Date.now()
    const dueForRelist = now - lastFullListAt >= FULL_RELIST_MS
    let diskNotes = notes
    if (dueForRelist) {
      diskNotes = await track("poll: listNotes", () => listNotes(folder))
      lastFullListAt = now
    }
    const diskActiveLastModified = await statNote(folder, activeName)
    return classifyDiskCheck({
      knownNotes: notes,
      diskNotes,
      knownLastModified: lastModified,
      diskActiveLastModified,
      dirty,
    })
  }

  // Whether a refresh may replace the editor buffer right now: only when there
  // are no unsaved local edits, no standing conflict, and no save in flight.
  // Checked live (not from a snapshot) right before mutating, since these can
  // change across the awaits inside refreshFromDisk.
  const safeToReplaceBuffer = (): boolean => !dirty && !conflict && !savePromise

  // Enter the conflict state and announce it once, handing the UI both versions
  // to diff (FEAT-0022): the buffer as-typed and the on-disk content read fresh
  // here (a `null` mtime means the file was deleted on disk). Reached either
  // reactively (a save refused by the stale-write guard) or proactively (the
  // poll loop noticing an external change while edits are pending) — one state,
  // one UX. `conflict` is set before the await so the save loop and the change
  // guard see it immediately, and `mine` is captured before the await so a
  // keystroke landing during the read can't change what is diffed. Crucially,
  // a failed disk read must NOT swallow the announcement: if `readNote` throws
  // (e.g. a permission lapse or I/O race), we still fire `onConflict` so the
  // modal appears and the editor is locked — leaving `conflict` true without
  // surfacing it would freeze the editor silently, with no way out.
  const raiseConflict = async (): Promise<void> => {
    conflict = true // stop autosaving so we never clobber the on-disk change
    const mine = view.state.doc.toString()
    let theirs: string | null = null
    if (dir) {
      try {
        const disk = await readNote(dir, activeName)
        theirs = disk.lastModified === null ? null : disk.content
      } catch {
        theirs = null // couldn't read the disk side; still surface the conflict
      }
    }
    opts.onConflict?.({ mine, theirs })
  }

  // Rewrite links in *other* notes that pointed at the just-renamed note so they
  // follow it (FEAT-0040). Runs after the move + active-note follow, inside the
  // same serialize slot. Reads each other note, rewrites via the pure core, and
  // writes each through saveNote's stale-write guard (the known mtime read moments
  // earlier), so a note edited from outside between the scan and the write is
  // skipped, never clobbered. The rewrite is silent and unconditional — a rename's
  // links should just follow it, the way a refactor-rename does; declining would
  // only leave the very dangling links this feature exists to prevent. The renamed
  // note (now `to`) is excluded, so a rename never mutates its own bytes here.
  const updateInboundLinks = async (
    folder: FileSystemDirectoryHandle,
    from: string,
    to: string,
    pathsBefore: ReadonlySet<string>,
  ): Promise<void> => {
    const pathsAfter = new Set(notes) // the post-move listing (set by the caller)
    for (const path of notes) {
      if (path === to) continue
      const { content, lastModified } = await readNote(folder, path)
      const rewritten = rewriteLinksForRename({
        text: content,
        notePath: path,
        oldPath: from,
        newPath: to,
        pathsBefore,
        pathsAfter,
      })
      // A conflict (the file changed on disk since we read it) is skipped — the
      // rewrite is dropped for that file, never overwriting an external edit.
      if (rewritten !== null) await saveNote(folder, path, rewritten, lastModified)
    }
  }

  // Rebase the moved note's *own* outbound relative markdown links (FEAT-0041): a
  // move to a different folder would otherwise leave its relative links pointing at
  // the wrong place. Reads the moved file (its bytes are the pre-move content, just
  // relocated), recomputes each in-tree relative destination from the new folder,
  // and writes it back through the stale-write guard. A same-folder rename leaves
  // every destination resolving identically, so the pure core returns null and
  // nothing is written. Runs before `activate`, so the editor loads the rebased
  // content. The folder check skips the file read entirely on a pure rename.
  const rebaseMovedNote = async (
    folder: FileSystemDirectoryHandle,
    from: string,
    to: string,
  ): Promise<void> => {
    if (folderOf(from) === folderOf(to)) return // same folder — outbound links unaffected
    const { content, lastModified } = await readNote(folder, to)
    const rebased = rebaseOutboundLinks(content, from, to)
    if (rebased !== null) await saveNote(folder, to, rebased, lastModified)
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
        // List first, commit `dir`/`notes` only once it succeeds: a folder that's
        // gone from disk (a dead vault) makes listNotes throw, and committing `dir`
        // before that would leave the controller half-pointed at the dead folder
        // (the poller would then probe it). On failure the previously open folder
        // stays intact, so a failed vault switch falls cleanly back to it.
        const folderNotes = await track("open: listNotes", () => listNotes(folder))
        dir = folder
        notes = folderNotes
        // Force the *next* probe to relist for real regardless of any previous
        // vault's throttle state — a freshly attached folder always gets one
        // verified listing before FULL_RELIST_MS throttling kicks in.
        lastFullListAt = -Infinity
        const active = pickActiveNote(notes, await loadActiveNote())
        await activate(folder, active)
      })
    },
    switchTo(name) {
      return serialize(async () => {
        if (!dir || name === activeName || conflict) return // conflict is modal
        mark(`switchTo: ${name}`)
        await track("flushAndWait", flushAndWait)
        await activate(dir, name)
      })
    },
    addNote(name) {
      return serialize<AddNoteResult>(async () => {
        if (!dir) return { ok: false, reason: "Open a folder first." }
        if (conflict) return { ok: false, reason: "Resolve the conflict first." }
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
        if (!dir || conflict) return // conflict is modal — resolve it first
        // Drop the deleted note's unsaved edits so the flush below won't write
        // them back. Then await flushAndWait regardless: it settles any save
        // already in flight (which would otherwise complete and re-create the
        // file after we delete it) before we remove it — `doSave` runs on its
        // own mutex outside this queue, so cancelling alone can't stop a write
        // already mid-flight.
        if (name === activeName) dirty = false
        await flushAndWait()
        await deleteNote(dir, name)
        contentCache.delete(name)
        notes = await listNotes(dir)
        if (name === activeName) {
          await activate(dir, pickActiveNote(notes, null))
        } else {
          opts.onListChanged?.(notes, activeName)
        }
      })
    },
    renameActive(name) {
      return serialize<AddNoteResult>(async () => {
        if (!dir) return { ok: false, reason: "Open a folder first." }
        if (conflict) return { ok: false, reason: "Resolve the conflict first." }
        const normalized = normalizeNoteName(name)
        if (!normalized.ok) return { ok: false, reason: normalized.reason }
        if (normalized.filename === activeName) return { ok: true } // no-op rename

        // Flush the open note before moving so its file carries the latest edits.
        // A flush can surface a conflict (the stale-write guard); if so, refuse.
        await flushAndWait()
        if (conflict) return { ok: false, reason: "Resolve the conflict first." }

        const from = activeName
        const result = await moveNote(dir, from, normalized.filename)
        if (result.status === "missing") {
          // `lastModified === null` means this note was never written to disk (a
          // lazy seed nobody has typed into yet) — so there is no file to move.
          // Say that, rather than the misleading "no longer exists" that fits the
          // other case (a file we did have, now gone from disk).
          return {
            ok: false,
            reason:
              lastModified === null
                ? "Type something into this note before renaming it — it hasn't been saved yet."
                : "The note no longer exists.",
          }
        }
        if (result.status === "exists") {
          return { ok: false, reason: "A note with that name already exists." }
        }
        // Follow the file: refresh the list, then re-point the editor at the new
        // path. `activate` → `load` re-reads it (adopting the new lastModified),
        // persists it as active, and announces so the UI tracks the new identity.
        const pathsBefore = new Set(notes) // pre-move listing — still names `from`
        contentCache.delete(from)
        notes = await listNotes(dir)
        // Follow-on link maintenance (FEAT-0040/0041). Both passes are best-effort:
        // the move already succeeded, so a failure here (an I/O error part-way) must
        // not report the rename as failed — the affected links simply stay as they
        // were (dangling), which the existing missing-target handling covers.
        try {
          await rebaseMovedNote(dir, from, normalized.filename) // before activate: editor loads the rebased content
        } catch {
          // leave the moved note's own outbound links as-is rather than failing
        }
        await activate(dir, normalized.filename)
        try {
          await updateInboundLinks(dir, from, normalized.filename, pathsBefore)
        } catch {
          // leave inbound links as-is rather than failing the rename
        }
        return { ok: true }
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
        // Skip with no folder, or while our own save is in flight: doSave runs
        // on its own mutex outside this queue, so mid-save the file's mtime has
        // moved but our `lastModified` hasn't caught up — checking now would
        // report our own write as an external change. The next poll sees a
        // settled, consistent state.
        if (!folder || savePromise) return { listChanged: null, active: null }
        return probeDisk(folder)
      })
    },
    refreshFromDisk() {
      return serialize(async () => {
        const folder = dir
        if (!folder || savePromise) return // same skip rationale as checkDisk
        const check = await probeDisk(folder)

        // Adopt an external list change first, so a follow-on switch (below)
        // picks the next note from the up-to-date listing.
        if (check.listChanged) {
          const newSet = new Set(check.listChanged)
          for (const path of contentCache.keys()) {
            if (!newSet.has(path)) contentCache.delete(path)
          }
          notes = check.listChanged
        }

        // The open note changed or was deleted on disk. With no unsaved local
        // edits it's safe to track the disk; with edits in flight it's a
        // conflict the user must resolve (keep mine / take theirs).
        const active = check.active
        if (active && !conflict) {
          if (!safeToReplaceBuffer()) {
            // Unsaved edits (or a save in flight) collide with the external
            // change — surface the conflict proactively, before autosave hits
            // the save-time guard. Both paths converge on the same state.
            await raiseConflict()
          } else if (active.kind === "deleted") {
            // The open note vanished and we have nothing to lose — switch off it.
            // `activate` loads, persists, and announces with the updated list.
            await activate(folder, pickActiveNote(notes, null))
            return
          } else {
            // Changed on disk: catch the buffer up and adopt the new mtime so
            // the next save bases off the absorbed version. Re-check live state
            // after the read — a keystroke landing during it turns this into a
            // conflict rather than a silent clobber.
            const note = await readNote(folder, activeName)
            if (safeToReplaceBuffer()) {
              lastModified = note.lastModified
              // Minimal-diff reload (FEAT-0067): replace only the differing span so the
              // caret and scroll survive — not a wholesale set that jumps the view.
              reloadEditorText(view, note.content)
              dirty = false
              contentCache.set(activeName, note)
            } else {
              await raiseConflict()
            }
          }
        }

        if (check.listChanged) opts.onListChanged?.(notes, activeName)
      })
    },
    resolveKeepMine() {
      return serialize(async () => {
        const folder = dir
        if (!folder || !conflict) return
        // Re-base on the file's current on-disk state so the guarded write goes
        // through (a deleted file has no handle, so it is simply re-created).
        const current = await statNote(folder, activeName)
        const result = await saveNote(folder, activeName, view.state.doc.toString(), current)
        if (result.status !== "saved") return // raced again — leave the conflict standing
        lastModified = result.lastModified
        contentCache.set(activeName, { content: view.state.doc.toString(), lastModified: result.lastModified })
        conflict = false
        dirty = false
        if (!notes.includes(activeName)) notes = await listNotes(folder) // re-created note
        opts.onListChanged?.(notes, activeName)
        opts.onConflictResolved?.()
      })
    },
    resolveTakeTheirs() {
      return serialize(async () => {
        const folder = dir
        if (!folder || !conflict) return
        // `load`/`activate` both reset `conflict` as they re-point the editor.
        if ((await statNote(folder, activeName)) === null) {
          // Deleted on disk — switch off it, like an external delete with no
          // edits. `activate` → `load` clears the conflict and notifies the UI.
          notes = await listNotes(folder)
          await activate(folder, pickActiveNote(notes, null))
        } else {
          // Changed on disk — adopt its content and mtime, dropping local edits.
          // `load` clears the conflict and fires onConflictResolved.
          contentCache.delete(activeName) // bypass cache — disk has newer content
          await load(folder, activeName)
          opts.onListChanged?.(notes, activeName)
        }
      })
    },
  }
}
