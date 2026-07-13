import type { EditorView } from "codemirror"
import { setEditorText, reloadEditorText } from "./editor"
import {
  readNote,
  saveNote,
  listNotes,
  createNote,
  deleteNote,
  statNote,
  moveNote,
  startSweep,
  continueSweep,
  sweepResult,
  createFolder,
  deleteFolder,
  listFolders,
  type NoteContent,
  type Sweep,
} from "./note"
import { track, trackSync, mark } from "./perf"
import { normalizeNoteName, normalizeFolderPath } from "./note-name"
import { rewriteLinksForRename, rebaseOutboundLinks } from "./link-rewrite"
import { saveActiveNote, loadActiveNote } from "./session"
import { debounce } from "./debounce"

const SEED_NOTE = "start.md"

/**
 * How often {@link NoteController.checkDisk} re-walks the whole tree in one shot
 * (FEAT-0014's external add/remove detection), vs. every poll tick (2s): a full
 * recursive `listNotes` is real work — proportional to vault size — while the
 * active note's own mtime (checked every tick regardless, see `probeDisk`) is one
 * cheap file stat. Detecting a file added/removed *elsewhere* by another tool can
 * afford to lag; silently clobbering the note you're actively editing cannot, so
 * that guarantee stays at the full 2s cadence.
 *
 * `refreshFromDisk` (the poller's real path) uses this the same way, but *between
 * sweeps* rather than between one-shot relists — see `SWEEP_TICK_BUDGET_MS`.
 */
const FULL_RELIST_MS = 15_000

/**
 * How much wall-clock time one poll tick spends continuing the relist sweep
 * (see `note.ts`'s `Sweep`), instead of walking the whole tree in a single go.
 * A real-device `?debug` capture kept showing an unrelated foreground `readNote`
 * slowing down (~75ms → 400-650ms) whenever it happened to overlap *any* part of
 * a relist — reducing concurrency (see `POLL_RELIST_CONCURRENCY`) and aborting
 * eagerly both helped, but couldn't shrink the one thing neither can touch:
 * whichever single directory scan is *already in flight* the instant the user
 * acts. Spreading the relist itself across many small slices (instead of one
 * multi-second walk) directly shrinks how much can be "already in flight" at any
 * given moment, for vaults of any size — a smaller, more direct lever than
 * concurrency or abortion. A vault small enough to finish within one budget
 * behaves exactly as before (a "sweep" that completes in its first tick).
 */
const SWEEP_TICK_BUDGET_MS = 400

/**
 * `open()`'s own initial-listing budget — bigger than a background poll tick's,
 * since there's a real user waiting for *a* sidebar, but the same idea: a
 * small vault finishes within this and behaves exactly as before, while a
 * large one shows whatever was found so far and hands the rest off to the
 * poll's existing sweep-continuation machinery (see `activeSweep`) instead of
 * blocking first paint on the entire tree — the whole reason `onPreviewReady`
 * exists is that nothing about seeing *a* note should wait on knowing *every*
 * note.
 */
const INITIAL_SWEEP_BUDGET_MS = 800

/**
 * `listNotes` concurrency for the poll's relist specifically: fully sequential.
 * A real-device `?debug` capture showed an unrelated foreground `readNote`
 * ballooning from ~75ms to ~490ms when it happened to run alongside a poll
 * relist even at the foreground default (4) — the device's File System Access
 * implementation appears to serialize/contend on concurrent I/O at a lower
 * level than our own queue. Nothing is waiting on the poll's own listing (it's
 * best-effort, cyclical, and never blocks anything — see the two-slot split in
 * `refreshFromDisk`), so there is no reason for it to compete for I/O as hard
 * as a foreground open() does; running it one folder at a time makes it the
 * gentlest possible neighbor to whatever the user is doing at the same moment.
 */
const POLL_RELIST_CONCURRENCY = 1

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
  /** Called whenever the set of folders changes (M35/FEAT-0069) — fired only by
   * `addFolder`/`removeFolder`. Ordinary note operations never affect folder
   * existence, so this stays rare; the UI doesn't need to re-walk the tree's
   * directories on every note add/delete/rename the way it would if this rode
   * along on `onListChanged` instead. */
  onFoldersChanged?: (folders: string[]) => void
  /**
   * Called from `open()` as soon as the *guessed* active note's content is
   * ready to show — before the full folder listing (and thus `notes`/the
   * sidebar) is confirmed. On a large vault the listing alone can take
   * several seconds; nothing about showing this one note's content depends
   * on it. Lets the UI reveal the workspace and the editor immediately
   * instead of holding a loading screen over an already-known answer. Not
   * fired if the guess fails to read, and reverted automatically (the editor
   * text only, nothing else) if the listing itself then fails.
   */
  onPreviewReady?: (path: string) => void
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
  /** Create an empty folder from a user-typed path (M35/FEAT-0069). Reports why
   * it failed; never touches the active note. */
  addFolder(path: string): Promise<AddNoteResult>
  /** Delete the folder at `path` and everything beneath it (M35/FEAT-0069); if
   * the active note lived inside it, switch to another note the same way
   * {@link removeNote} does. */
  removeFolder(path: string): Promise<void>
  /**
   * Move the folder at `fromPath` (and everything beneath it) to `toPath`
   * (M35/FEAT-0070): every note in the subtree relocates via `moveNote`, its
   * own outbound links rebase and inbound links from other notes follow, same
   * as a rename — just driven once per note instead of once. Refuses (without
   * moving anything) when `toPath` is `fromPath` itself or a descendant of
   * it. If the active note was inside the moved folder, the editor follows
   * it to its new path.
   */
  moveFolder(fromPath: string, toPath: string): Promise<AddNoteResult>
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
  // The poll's currently in-flight relist, if any — so a foreground action can
  // tell it to stop starting new directory scans (see `abortPendingRelist`).
  // There is no way to abort a `values()` scan already running, so this only
  // shrinks the contention window down to "whatever's already in flight",
  // rather than "the rest of the whole tree" — see DECISIONS.md.
  let pollAbortController: AbortController | null = null
  // The poll's in-progress relist sweep, if any — persists across poll ticks
  // (unlike `pollAbortController`, which is per-tick) so a sweep interrupted by
  // its time budget or an abort resumes exactly where it left off next tick,
  // rather than restarting the whole walk. `null` between sweeps.
  let activeSweep: Sweep | null = null
  // `notes` at the moment the *current* sweep began — set once, when the sweep
  // starts, not on every tick. Compared against live `notes` only once the
  // sweep finally completes, to detect whether some other operation (an
  // addNote/removeNote/renameActive) already refreshed `notes` more recently
  // than this (possibly many-ticks-old) sweep's view of the tree.
  let sweepStartNotes: string[] | null = null

  // A user-initiated action is about to run — if a background relist is
  // currently walking the tree, tell it to stop making further progress. Safe
  // to call unconditionally (a no-op when nothing is in flight, and aborting
  // an already-settled/already-aborted controller is a no-op too).
  const abortPendingRelist = (): void => {
    pollAbortController?.abort()
  }

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
  // `prefetched`, when given, is a read of `name` already in flight/settled
  // before `load` was called (see `open`'s speculative read below) — skips a
  // redundant disk read when the guess it came from turns out right.
  const load = async (
    folder: FileSystemDirectoryHandle,
    name: string,
    prefetched?: NoteContent,
  ): Promise<void> => {
    activeName = name
    if (conflict) {
      conflict = false
      opts.onConflictResolved?.()
    }
    const cached = contentCache.get(name)
    if (cached) mark(`cache hit: ${name}`)
    const note = cached ?? prefetched ?? (await track(`readNote: ${name}`, () => readNote(folder, name)))
    if (!cached) contentCache.set(name, note)
    lastModified = note.lastModified
    // Skip the redraw if the buffer already shows this exact content — e.g.
    // open()'s speculative preview already rendered it correctly, and this is
    // just the confirming call once the listing succeeds. Avoids a redundant
    // full-document replace (a stray undo-history entry, a wasted decoration
    // rebuild) for what amounts to a no-op.
    if (view.state.doc.toString() !== note.content) {
      trackSync("setEditorText", () => setEditorText(view, note.content))
    }
    dirty = false // discard any stray edit typed on the old content during the read
  }

  // Make `name` the active note and announce it. The caller has already flushed
  // (or deliberately dropped) the previously open note's edits.
  const activate = async (
    folder: FileSystemDirectoryHandle,
    name: string,
    prefetched?: NoteContent,
  ): Promise<void> => {
    await load(folder, name, prefetched)
    await saveActiveNote(name)
    opts.onListChanged?.(notes, name)
  }

  // Whether a full relist is due (shared by probeDisk and refreshFromDisk's
  // snapshot slot, so the throttle policy lives in exactly one place).
  const isDueForRelist = (): boolean => Date.now() - lastFullListAt >= FULL_RELIST_MS

  // Probe the disk and classify it against the controller's current view. No
  // state is adopted — detection only. Callers run this inside a serialize slot
  // so `notes`/`activeName`/`lastModified` stay stable across its awaits.
  const probeDisk = async (folder: FileSystemDirectoryHandle): Promise<DiskCheck> => {
    const dueForRelist = isDueForRelist()
    let diskNotes = notes
    if (dueForRelist) {
      diskNotes = await track("poll: listNotes", () => listNotes(folder, POLL_RELIST_CONCURRENCY))
      lastFullListAt = Date.now()
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

  // Rewrite links in *other* notes that pointed at a just-moved note so they
  // follow it (FEAT-0040), generalized from one move to a list (M35/FEAT-0070's
  // moveFolder relocates many notes at once). Runs after the move(s) + active-note
  // follow, inside the same serialize slot. Reads each other note *once* even if it
  // links to several of the moved notes — folding every move's rewrite over the
  // text in sequence — and writes it back through saveNote's stale-write guard (the
  // known mtime read moments earlier), so a note edited from outside between the
  // scan and the write is skipped, never clobbered. The rewrite is silent and
  // unconditional — a move's links should just follow it, the way a refactor-rename
  // does; declining would only leave the very dangling links this feature exists to
  // prevent. Every moved note's *own* new path is excluded, so a move never mutates
  // a moved note's own bytes here (that's `rebaseMovedNote`'s job, for outbound links).
  const updateInboundLinksForMoves = async (
    folder: FileSystemDirectoryHandle,
    moves: { from: string; to: string }[],
    pathsBefore: ReadonlySet<string>,
  ): Promise<void> => {
    const pathsAfter = new Set(notes) // the post-move listing (set by the caller)
    const movedTo = new Set(moves.map((move) => move.to))
    for (const path of notes) {
      if (movedTo.has(path)) continue
      const { content, lastModified } = await readNote(folder, path)
      let text = content
      for (const { from, to } of moves) {
        const rewritten = rewriteLinksForRename({ text, notePath: path, oldPath: from, newPath: to, pathsBefore, pathsAfter })
        if (rewritten !== null) text = rewritten
      }
      // A conflict (the file changed on disk since we read it) is skipped — the
      // rewrite is dropped for that file, never overwriting an external edit.
      if (text !== content) await saveNote(folder, path, text, lastModified)
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
      abortPendingRelist() // a whole vault switch makes any in-flight relist moot
      return serialize(async () => {
        if (dir) await flushAndWait() // re-picking a folder: don't lose the open note

        // The full recursive listing is the slow, vault-size-proportional part
        // (several seconds on a large real-device vault); reading one
        // guessed-at file is not. Start both at once instead of reading only
        // after the listing settles — by the time the listing confirms the
        // folder is valid, the guessed note's content is usually already in
        // hand. The listing itself is a *sweep* (see note.ts), same mechanism
        // the poll uses: a small vault finishes within `INITIAL_SWEEP_BUDGET_MS`
        // and nothing below changes; a large one shows whatever's found so far
        // and hands the rest to the poll (`activeSweep`) instead of blocking
        // first paint on the entire tree. Purely I/O: nothing here touches
        // `dir`/`notes` or the editor, so a sweep failure below still leaves
        // everything exactly as it was (see the safety comment kept on that
        // await).
        const sweep = startSweep(folder)
        const sweepPromise = continueSweep(sweep, INITIAL_SWEEP_BUDGET_MS)
        const persisted = await loadActiveNote()
        const guess = persisted ?? SEED_NOTE
        const speculativeRead = track(`readNote (speculative): ${guess}`, () => readNote(folder, guess)).catch(
          () => null,
        )

        // Preview the guess as soon as it's ready, instead of making the user
        // watch a loading screen for however long the listing takes on top of
        // that. Pure UI: `setEditorText` never marks the buffer dirty or
        // touches saved state, so there is nothing to unwind if the guess
        // later turns out wrong — `activate` below corrects the display to
        // the real note once the listing confirms it either way. `openFailed`
        // guards against the read resolving *after* the listing has already
        // failed (rare, but otherwise this would paint over the revert below).
        const previousDocText = view.state.doc.toString()
        let openFailed = false
        void speculativeRead.then((note) => {
          if (note && !openFailed) {
            trackSync("setEditorText (preview)", () => setEditorText(view, note.content))
            opts.onPreviewReady?.(guess)
          }
        })

        // Commit `dir`/`notes` only once the sweep's first budget settles: a
        // folder that's gone from disk (a dead vault) makes it throw (the very
        // first thing it visits is the root itself), and committing `dir`
        // before that would leave the controller half-pointed at the dead
        // folder (the poller would then probe it). On failure the previously
        // open folder stays intact, so a failed vault switch falls cleanly back
        // to it — undo the preview above if it already painted over that.
        let complete: boolean
        try {
          complete = await track("open: sweep", () => sweepPromise)
        } catch (err) {
          openFailed = true
          if (view.state.doc.toString() !== previousDocText) {
            trackSync("setEditorText (revert)", () => setEditorText(view, previousDocText))
          }
          throw err
        }
        dir = folder
        notes = sweepResult(sweep)
        // The cache is keyed by relative path only, not by folder — reused
        // across every vault this one controller instance ever attaches to
        // (M33 multi-vault). Every vault's seed note shares the name
        // `start.md`, so a stale entry from a previous vault would otherwise
        // silently outrank this vault's real content in `load()`. Clearing on
        // every (re-)open is always safe, just an occasional cache miss.
        contentCache.clear()
        // Force the *next* probe to relist for real regardless of any
        // previous vault's throttle state — a freshly attached folder always
        // gets one verified listing before FULL_RELIST_MS throttling kicks in
        // (unchanged from before the sweep migration). A sweep handed off
        // below still just continues on the next tick regardless of this.
        lastFullListAt = -Infinity
        if (complete) {
          activeSweep = null
          sweepStartNotes = null
        } else {
          // Didn't finish within budget: hand the same sweep off to the poll,
          // which already knows how to keep advancing an in-progress one
          // (see refreshFromDisk) — it'll complete in the background and
          // update `notes`/the sidebar again once it does, exactly like
          // catching up on an external change.
          activeSweep = sweep
          sweepStartNotes = notes
        }
        const active = pickActiveNote(notes, persisted)
        // Only worth adopting the speculative read if the guess it was based on
        // is the note we're actually activating — otherwise (a fresh vault, or
        // the persisted note vanished since last session) `activate` falls back
        // to its own normal read.
        const prefetched = active === guess ? await speculativeRead : null
        await activate(folder, active, prefetched ?? undefined)
      })
    },
    switchTo(name) {
      abortPendingRelist() // don't make the user's switch wait behind our own background scan
      return serialize(async () => {
        if (!dir || name === activeName || conflict) return // conflict is modal
        mark(`switchTo: ${name}`)
        await track("flushAndWait", flushAndWait)
        await activate(dir, name)
      })
    },
    addNote(name) {
      abortPendingRelist()
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
      abortPendingRelist()
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
    addFolder(path) {
      abortPendingRelist()
      return serialize<AddNoteResult>(async () => {
        if (!dir) return { ok: false, reason: "Open a folder first." }
        if (conflict) return { ok: false, reason: "Resolve the conflict first." }
        const normalized = normalizeFolderPath(path)
        if (!normalized.ok) return { ok: false, reason: normalized.reason }
        const created = await createFolder(dir, normalized.path)
        if (created.status === "exists") {
          return { ok: false, reason: "A folder with that name already exists." }
        }
        // An empty folder adds no `.md` file — nothing for onListChanged to
        // announce — so its own dedicated notification carries the fresh
        // folder listing instead.
        opts.onFoldersChanged?.(await listFolders(dir))
        return { ok: true }
      })
    },
    removeFolder(path) {
      abortPendingRelist()
      return serialize(async () => {
        if (!dir || conflict) return // conflict is modal — resolve it first
        const activeInsideFolder = activeName === path || activeName.startsWith(path + "/")
        // Same reasoning as removeNote: drop the active note's unsaved edits
        // before it's yanked out from under an in-flight save, then flush to
        // settle anything already mid-write before we delete.
        if (activeInsideFolder) dirty = false
        await flushAndWait()
        await deleteFolder(dir, path)
        for (const key of contentCache.keys()) {
          if (key.startsWith(path + "/")) contentCache.delete(key)
        }
        notes = await listNotes(dir)
        opts.onFoldersChanged?.(await listFolders(dir))
        if (activeInsideFolder) {
          await activate(dir, pickActiveNote(notes, null))
        } else {
          opts.onListChanged?.(notes, activeName)
        }
      })
    },
    moveFolder(fromPath, toPath) {
      abortPendingRelist()
      return serialize<AddNoteResult>(async () => {
        if (!dir) return { ok: false, reason: "Open a folder first." }
        if (conflict) return { ok: false, reason: "Resolve the conflict first." }
        if (toPath === fromPath || toPath.startsWith(fromPath + "/")) {
          return { ok: false, reason: "Can't move a folder into itself or one of its own subfolders." }
        }

        const activeInsideFolder = activeName === fromPath || activeName.startsWith(fromPath + "/")
        if (activeInsideFolder) {
          await flushAndWait()
          if (conflict) return { ok: false, reason: "Resolve the conflict first." }
        }

        const pathsBefore = new Set(notes)
        const toMove = notes.filter((path) => path.startsWith(fromPath + "/"))
        const moves: { from: string; to: string }[] = []
        let newActiveName: string | null = null
        for (const oldPath of toMove) {
          const newPath = toPath + oldPath.slice(fromPath.length)
          const result = await moveNote(dir, oldPath, newPath)
          if (result.status !== "moved") continue // occupied/missing — leave this one where it is
          contentCache.delete(oldPath)
          try {
            await rebaseMovedNote(dir, oldPath, newPath)
          } catch {
            // leave this note's own outbound links as-is rather than failing the move
          }
          moves.push({ from: oldPath, to: newPath })
          if (oldPath === activeName) newActiveName = newPath
        }

        // Empty subfolders (no notes anywhere beneath them) never move on their
        // own — nothing in the loop above touches them. Deepest paths first so a
        // parent's `createFolder` never races a not-yet-relocated child.
        const emptySubfolders = (await listFolders(dir))
          .filter((path) => path.startsWith(fromPath + "/"))
          .sort((a, b) => b.length - a.length)
        for (const emptyFolder of emptySubfolders) {
          await createFolder(dir, toPath + emptyFolder.slice(fromPath.length))
          await deleteFolder(dir, emptyFolder)
        }
        // The folder itself is moving — unlike an incidentally emptied folder
        // (M35/FEAT-0069), it never lingers at the old path once relocated.
        await createFolder(dir, toPath)
        await deleteFolder(dir, fromPath)

        notes = await listNotes(dir)
        try {
          await updateInboundLinksForMoves(dir, moves, pathsBefore)
        } catch {
          // leave inbound links as-is rather than failing the move
        }
        opts.onFoldersChanged?.(await listFolders(dir))
        if (newActiveName) {
          await activate(dir, newActiveName)
        } else {
          opts.onListChanged?.(notes, activeName)
        }
        return { ok: true }
      })
    },
    renameActive(name) {
      abortPendingRelist()
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
          await updateInboundLinksForMoves(dir, [{ from, to: normalized.filename }], pathsBefore)
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
      // The expensive part — the relist sweep, throttled to FULL_RELIST_MS
      // *between* sweeps — must never sit inside the serialize queue: a
      // user-initiated action (switchTo, addNote, …) queued behind it would
      // otherwise wait out the whole thing just to, say, switch notes. So
      // this runs across two short serialize() slots with the slow sweep step
      // in between them, not inside either — anything else queued can run
      // while it's in flight. The apply slot re-validates against *live*
      // state (not the snapshot), the same "recheck right before mutating"
      // discipline the rest of this file already uses for its other awaits
      // (see `safeToReplaceBuffer`).
      return (async () => {
        const snapshot = await serialize(async () => {
          if (!dir || savePromise) return null // same skip rationale as checkDisk
          // Start a new sweep only if none is already in progress — an
          // in-progress one always continues regardless of the throttle
          // (it's already committed; abandoning it would waste the ticks
          // already spent). `sweepStartNotes` is captured once, here, not
          // re-captured on later ticks that merely continue the same sweep.
          if (!activeSweep && isDueForRelist()) {
            activeSweep = startSweep(dir)
            sweepStartNotes = notes
          }
          return { folder: dir, sweep: activeSweep }
        })
        if (!snapshot) return

        let sweepCompleted = false
        let sweepThrew = false
        if (snapshot.sweep) {
          const abortController = new AbortController()
          pollAbortController = abortController
          try {
            sweepCompleted = await track("poll: sweep tick", () =>
              continueSweep(snapshot.sweep as Sweep, SWEEP_TICK_BUDGET_MS, abortController.signal),
            )
          } catch (err) {
            // A folder likely disappeared mid-sweep (or some other I/O error) —
            // drop this attempt rather than let it wedge the poll forever on
            // the same now-broken queue; the next due tick starts fresh.
            sweepThrew = true
            console.error("Relist sweep failed, will restart on the next attempt:", err)
          } finally {
            pollAbortController = null
          }
        }

        return serialize(async () => {
          // The folder changed (a vault switch) or our own save started while
          // the sweep tick was in flight — this probe no longer applies to
          // anything live.
          if (dir !== snapshot.folder || savePromise) return
          // Something else (an addNote/removeNote/renameActive) already
          // updated `notes` more recently than this sweep's view of the tree
          // — its result is stale now; drop it rather than risk clobbering a
          // newer state with it. Crucially, don't bump the throttle clock in
          // this case either — that would extend the "next real check" wait
          // past FULL_RELIST_MS instead of starting a fresh sweep on the very
          // next (2s) tick as intended.
          const listStale = sweepCompleted && notes !== sweepStartNotes
          const gotFreshList = sweepCompleted && !listStale
          if (sweepCompleted || sweepThrew) {
            // The sweep is done either way — successfully applied, dropped as
            // stale, or blew up entirely — clear it so the next due tick
            // starts a fresh one rather than retrying the same broken queue.
            activeSweep = null
            sweepStartNotes = null
          }
          if (gotFreshList) lastFullListAt = Date.now()
          const diskNotes = gotFreshList ? sweepResult(snapshot.sweep as Sweep) : notes
          const diskActiveLastModified = await statNote(snapshot.folder, activeName)
          const check = classifyDiskCheck({
            knownNotes: notes,
            diskNotes,
            knownLastModified: lastModified,
            diskActiveLastModified,
            dirty,
          })

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
              await activate(snapshot.folder, pickActiveNote(notes, null))
              return
            } else {
              // Changed on disk: catch the buffer up and adopt the new mtime so
              // the next save bases off the absorbed version. Re-check live state
              // after the read — a keystroke landing during it turns this into a
              // conflict rather than a silent clobber.
              const note = await readNote(snapshot.folder, activeName)
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
      })()
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
