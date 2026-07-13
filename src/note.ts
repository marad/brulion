/**
 * Read, write, list, create, and delete notes — each a `.md` file somewhere in
 * the folder tree the user picked, addressed by its folder-relative POSIX path
 * (`projects/diablo.md`). The folder tree is the source of truth (no index file).
 * The save path guards against silently overwriting a file that changed
 * underneath us (another editor, a sync client, an AI writing to the folder) —
 * the file-fidelity moat.
 */

const MD_EXT = /\.md$/i

export interface NoteContent {
  content: string
  /** The file's `lastModified` when read, or `null` if it does not exist yet. */
  lastModified: number | null
}

export type SaveResult =
  | { status: "saved"; lastModified: number }
  | { status: "conflict" }

export type CreateResult = { status: "created" } | { status: "exists" }

export type CreateFolderResult = { status: "created" } | { status: "exists" }

export type MoveResult =
  | { status: "moved" }
  | { status: "exists" }
  | { status: "missing" }

/** `FileSystemFileHandle.move` is shipping in Chromium but not yet in the DOM
 * lib types; narrow to the two-arg form we use (new parent + new name). */
interface MovableFileHandle extends FileSystemFileHandle {
  move(destination: FileSystemDirectoryHandle, name: string): Promise<void>
}

/** Read `name`; an absent file reads as empty content with `null` mtime. */
export async function readNote(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<NoteContent> {
  const handle = await getExisting(dir, name)
  if (!handle) return { content: "", lastModified: null }
  const file = await handle.getFile()
  return { content: await file.text(), lastModified: file.lastModified }
}

/**
 * Write `content` to `name`, creating it if absent. Before overwriting an
 * existing file, compare its current `lastModified` with `knownLastModified`
 * (what the caller last read/wrote); if it changed — or a file appeared where
 * the caller saw none — refuse to write and report a conflict.
 */
export async function saveNote(
  dir: FileSystemDirectoryHandle,
  name: string,
  content: string,
  knownLastModified: number | null,
): Promise<SaveResult> {
  const existing = await getExisting(dir, name)
  if (existing) {
    const current = (await existing.getFile()).lastModified
    if (knownLastModified === null || current !== knownLastModified) {
      return { status: "conflict" }
    }
  }

  const { folders, file } = splitPath(name)
  const parent = await resolveParent(dir, folders, true)
  const handle = await parent.getFileHandle(file, { create: true })
  const writable = await handle.createWritable()
  await writable.write(content)
  await writable.close()

  const lastModified = (await handle.getFile()).lastModified
  return { status: "saved", lastModified }
}

/**
 * The `lastModified` of `name`, or `null` if it does not exist — a cheap
 * existence/mtime probe for change detection that avoids reading the content.
 */
export async function statNote(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<number | null> {
  const handle = await getExisting(dir, name)
  if (!handle) return null
  return (await handle.getFile()).lastModified
}

/** Default concurrency for a foreground `listNotes` call (folder open, a
 * create/delete/rename refreshing the list) — someone is waiting on it, so
 * some parallelism is worth the contention it costs. See the comment on
 * `collect` for why it's capped at all. The background poll's periodic
 * relist passes its own, lower `maxConcurrent` (see `note-controller.ts`):
 * nothing is waiting on *that* one, so it can afford to be the gentlest
 * possible neighbor to whatever the user is doing at the same moment. */
const MAX_CONCURRENT_WALKS = 4

/** Limits how many callers hold a "slot" at once; anyone past the limit awaits
 * `acquire()` until someone else `release()`s. Used to cap {@link collect}'s
 * total in-flight directory scans regardless of the tree's shape (a per-level
 * cap, or a worker pool that only pulls from an initially-empty queue, both
 * fail to bound *total* concurrency for a narrow-then-wide, or deep, tree). */
class Semaphore {
  private slots: number
  private waiting: Array<() => void> = []
  constructor(slots: number) {
    this.slots = slots
  }
  async acquire(): Promise<void> {
    if (this.slots > 0) {
      this.slots--
      return
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve))
  }
  release(): void {
    const next = this.waiting.shift()
    if (next) next()
    else this.slots++
  }
}

/** Every `.md` file in the tree as a `/`-separated relative path, sorted
 * case-insensitively by full path. Directories are descended into, not listed.
 * `maxConcurrent` (default {@link MAX_CONCURRENT_WALKS}) bounds how many
 * directory scans run at once — lower it for background/best-effort callers
 * that shouldn't compete hard for I/O with whatever the user is doing.
 *
 * `signal`, when given, lets a caller abandon an in-flight call — see
 * {@link collect} for what "abandon" actually means here (there is no way to
 * abort a `values()` scan already running; this only stops *starting new
 * ones*). Rejects with a `DOMException("AbortError")` if aborted, same
 * convention as `fetch()` — never returns a silently-incomplete listing that
 * could be mistaken for the real disk state. */
export async function listNotes(
  dir: FileSystemDirectoryHandle,
  maxConcurrent: number = MAX_CONCURRENT_WALKS,
  signal?: AbortSignal,
): Promise<string[]> {
  const paths: string[] = []
  await collect(dir, "", paths, new Semaphore(maxConcurrent), signal)
  return paths.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
}

/** Recurse `dir`, pushing `prefix`-qualified relative paths of `.md` files.
 * Each call acquires a semaphore slot before its own single-level `values()`
 * scan and releases it right after — before recursing into subfolders — so at
 * most `MAX_CONCURRENT_WALKS` directory scans are ever active at once, across
 * the whole recursion, not per level. An earlier version fired every
 * subfolder's scan via one unbounded `Promise.all`, which measurably starved
 * an unrelated concurrent single-file `readNote` on at least one real phone
 * (a ~70ms read ballooned to ~1.5s while a many-folder relist was in flight):
 * flooding the device's file-system API with a burst of simultaneous calls
 * costs more elsewhere than the relist itself gains from parallelism.
 * `listNotes` sorts the result anyway, so arrival order into `out` never
 * matters — only the total concurrency does.
 *
 * `signal` is checked before every single-level scan starts (both before and
 * after waiting for a semaphore slot, since it may go stale while queued), and
 * again before every single entry *within* an already-running scan — there is
 * no `AbortSignal` on the platform's own `values()` iteration, so the current
 * `next()` call in flight can't be interrupted, but a folder holding hundreds
 * of entries doesn't have to run to completion once aborted mid-iteration. All
 * three checkpoints throw if aborted, never silently returning a truncated
 * listing that could be mistaken for the real disk state. */
async function collect(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  out: string[],
  sem: Semaphore,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
  await sem.acquire()
  if (signal?.aborted) {
    sem.release()
    throw new DOMException("Aborted", "AbortError")
  }
  const subdirs: FileSystemDirectoryHandle[] = []
  try {
    for await (const entry of dir.values()) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
      if (entry.kind === "file") {
        if (MD_EXT.test(entry.name)) out.push(prefix + entry.name)
      } else {
        subdirs.push(entry)
      }
    }
  } finally {
    sem.release()
  }
  await Promise.all(subdirs.map((entry) => collect(entry, prefix + entry.name + "/", out, sem, signal)))
}

/**
 * List every **folder** under `dir` (M35/FEAT-0069), sorted the same way as
 * {@link listNotes} — a sibling walk, not a byproduct of the note listing, so
 * an empty folder (no `.md` file inside it) is still reported. Kept as its
 * own walk rather than folded into `listNotes`'s return shape: that would
 * touch every one of `listNotes`'s existing callers for a feature only the
 * sidebar tree needs. Same concurrency/abort behavior as `listNotes`.
 */
export async function listFolders(
  dir: FileSystemDirectoryHandle,
  maxConcurrent: number = MAX_CONCURRENT_WALKS,
  signal?: AbortSignal,
): Promise<string[]> {
  const paths: string[] = []
  await collectFolders(dir, "", paths, new Semaphore(maxConcurrent), signal)
  return paths.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
}

/** Recurse `dir`, pushing `prefix`-qualified relative paths of every
 * subdirectory (unlike {@link collect}, which pushes `.md` files) — the same
 * semaphore-bounded, abortable shape, for the same reason (see `collect`'s
 * doc comment). */
async function collectFolders(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  out: string[],
  sem: Semaphore,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
  await sem.acquire()
  if (signal?.aborted) {
    sem.release()
    throw new DOMException("Aborted", "AbortError")
  }
  const subdirs: FileSystemDirectoryHandle[] = []
  try {
    for await (const entry of dir.values()) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
      if (entry.kind === "directory") {
        out.push(prefix + entry.name)
        subdirs.push(entry)
      }
    }
  } finally {
    sem.release()
  }
  await Promise.all(subdirs.map((entry) => collectFolders(entry, prefix + entry.name + "/", out, sem, signal)))
}

/**
 * A `listNotes` walk that can be paused and resumed across many calls instead
 * of always running to completion in one go — for a caller (the poll relist)
 * that has no one waiting on it and would rather spend a small slice of time
 * every few seconds than a multi-second burst all at once, however large the
 * vault. `pending` is a plain FIFO queue of folders not yet visited *in this
 * sweep*; `files` accumulates matches as they're found. Both are exposed (not
 * hidden behind a class) so a caller can inspect progress, but should only be
 * mutated by {@link continueSweep}.
 */
export interface Sweep {
  pending: Array<{ dir: FileSystemDirectoryHandle; prefix: string }>
  files: string[]
}

/** Begin a new sweep of `root` — nothing visited yet. */
export function startSweep(root: FileSystemDirectoryHandle): Sweep {
  return { pending: [{ dir: root, prefix: "" }], files: [] }
}

/**
 * Visit folders breadth-first off `sweep.pending`, mutating `sweep` in place,
 * until either the queue empties (the sweep is complete — returns `true`) or
 * `budgetMs` of wall-clock time elapses or `signal` aborts (returns `false`,
 * with `sweep` left exactly where it can pick up again on the next call —
 * nothing already visited is redone, and nothing already-fetched is dropped:
 * the deadline/abort check runs *after* recording each entry, never before,
 * since an entry already retrieved from `values()` has already been paid for).
 * Unlike {@link listNotes}, running out of time or being aborted is the
 * ordinary, expected way for this to end, not an error: the whole point is
 * many short, interruptible slices instead of one long walk, so this returns
 * a plain boolean rather than throwing.
 */
export async function continueSweep(sweep: Sweep, budgetMs: number, signal?: AbortSignal): Promise<boolean> {
  const deadline = performance.now() + budgetMs
  while (sweep.pending.length > 0) {
    if (signal?.aborted || performance.now() >= deadline) return false
    // FIFO (not LIFO): breadth-first, so a sweep interrupted partway through a
    // vault touches a bit of everything rather than exhausting one deep branch
    // before starting its siblings.
    const { dir, prefix } = sweep.pending.shift() as { dir: FileSystemDirectoryHandle; prefix: string }
    for await (const entry of dir.values()) {
      // Always record an entry once it's arrived — it's already been paid
      // for (the `next()` call already happened), so bailing *before* using
      // it would silently drop real, already-fetched data. Check the budget
      // only after, to decide whether to fetch the *next* one.
      if (entry.kind === "file") {
        if (MD_EXT.test(entry.name)) sweep.files.push(prefix + entry.name)
      } else {
        sweep.pending.push({ dir: entry, prefix: prefix + entry.name + "/" })
      }
      if (signal?.aborted || performance.now() >= deadline) return false
    }
  }
  return true
}

/** The sorted path list for a *complete* sweep (`continueSweep` returned
 * `true`) — same sort as {@link listNotes}, so the two are interchangeable
 * from a caller's point of view once a sweep finishes. */
export function sweepResult(sweep: Sweep): string[] {
  return sweep.files.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
}

/**
 * Create an empty `name`. If a file already exists it is left untouched and
 * `{ status: "exists" }` is returned, so a name clash never clobbers content.
 * A folder segment occupied by a like-named *file* (so the folder can't be
 * created) is also reported as `exists` — the path is taken — rather than
 * surfacing a raw `TypeMismatchError`.
 */
export async function createNote(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<CreateResult> {
  if (await getExisting(dir, name)) return { status: "exists" }
  const { folders, file } = splitPath(name)
  let parent: FileSystemDirectoryHandle
  try {
    parent = await resolveParent(dir, folders, true)
  } catch (err) {
    if (isAbsent(err)) return { status: "exists" } // a file blocks a folder segment
    throw err
  }
  const handle = await parent.getFileHandle(file, { create: true })
  const writable = await handle.createWritable()
  await writable.close() // materialize an empty file
  return { status: "created" }
}

/** Remove `name` from the folder. Already-absent is a no-op (idempotent): the
 * folder has many writers, so a note we mean to delete may already be gone. */
export async function deleteNote(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<void> {
  try {
    const { folders, file } = splitPath(name)
    const parent = await resolveParent(dir, folders, false)
    if (!parent) return // a missing intermediate folder means the note is already gone
    await parent.removeEntry(file)
  } catch (err) {
    if (!isNotFound(err)) throw err
  }
}

/**
 * Create an empty real directory at `path` (M35/FEAT-0069) — unlike a note's
 * folder, which only ever exists as a side effect of a file inside it, this
 * materializes the folder itself. If one already exists there it is left
 * untouched and `{ status: "exists" }` is returned, same shape as
 * {@link createNote}; a like-named *file* occupying the path is reported the
 * same way rather than surfacing a raw `TypeMismatchError`.
 */
export async function createFolder(
  dir: FileSystemDirectoryHandle,
  path: string,
): Promise<CreateFolderResult> {
  if (await getExistingFolder(dir, path)) return { status: "exists" }
  const { folders, file } = splitPath(path)
  let parent: FileSystemDirectoryHandle
  try {
    parent = await resolveParent(dir, folders, true)
  } catch (err) {
    if (isAbsent(err)) return { status: "exists" } // a file blocks a folder segment
    throw err
  }
  try {
    await parent.getDirectoryHandle(file, { create: true })
  } catch (err) {
    if (isAbsent(err)) return { status: "exists" } // a file already occupies `file`
    throw err
  }
  return { status: "created" }
}

/** Remove the folder at `path` and everything beneath it. Already-absent is a
 * no-op (idempotent), same reasoning as {@link deleteNote}. */
export async function deleteFolder(
  dir: FileSystemDirectoryHandle,
  path: string,
): Promise<void> {
  try {
    const { folders, file } = splitPath(path)
    const parent = await resolveParent(dir, folders, false)
    if (!parent) return // a missing intermediate folder means it's already gone
    await parent.removeEntry(file, { recursive: true })
  } catch (err) {
    if (!isNotFound(err)) throw err
  }
}

/**
 * Move the note at `from` to `to` within the tree. Prefers the native
 * `FileSystemFileHandle.move()` — the file's bytes are relocated as-is, with no
 * read, rewrite, or intermediate copy, so a rename neither loses nor churns
 * content (the file-fidelity moat). Where the engine doesn't implement `move()`,
 * or refuses it (e.g. Android Chrome's "state changed since it was read from
 * disk" check rejects moving a handle whose backing file it considers stale), it
 * falls back to copy-then-delete: read the source fresh, write the destination (a
 * brand-new file, so no stale-state guard applies), then delete the source —
 * **write before delete**, so a mid-way failure leaves a duplicate at worst,
 * never lost content. Destination folders are materialized like
 * `saveNote`/`createNote`. Refuses to overwrite an existing destination
 * (`exists`) — the source is left untouched — and reports a missing source
 * (`missing`). A `from` equal to `to` is a `moved` no-op. The destination is
 * only touched once both guards pass, so a refused move leaves nothing behind.
 */
export async function moveNote(
  dir: FileSystemDirectoryHandle,
  from: string,
  to: string,
): Promise<MoveResult> {
  if (from === to) return { status: "moved" }
  const source = await getExisting(dir, from)
  if (!source) return { status: "missing" }
  if (await getExisting(dir, to)) return { status: "exists" }

  const movable = source as Partial<MovableFileHandle>
  if (typeof movable.move === "function") {
    const { folders, file } = splitPath(to)
    let parent: FileSystemDirectoryHandle
    try {
      parent = await resolveParent(dir, folders, true)
      await movable.move(parent, file)
      return { status: "moved" }
    } catch (err) {
      if (isAbsent(err)) return { status: "exists" } // a file blocks a folder segment — like createNote
      // Native move refused (a strict engine's stale-state check, an unexpected
      // I/O error): fall through to the copy-then-delete path below.
    }
  }

  // Fallback "read before write": copy the source's current bytes to the new
  // path, then remove the old file. `to` is known-free (guarded above), so the
  // null `knownMtime` create path applies; a `conflict` means a file raced into
  // `to`, which we report as `exists` rather than clobbering it.
  const content = await (await source.getFile()).text()
  const written = await saveNote(dir, to, content, null)
  if (written.status !== "saved") return { status: "exists" }
  await deleteNote(dir, from)
  return { status: "moved" }
}

/** The file handle for the note at `path` if it exists, else `null` — including
 * when an intermediate folder on the way to it is missing, or a path segment
 * names a file where a folder was expected. */
async function getExisting(
  dir: FileSystemDirectoryHandle,
  path: string,
): Promise<FileSystemFileHandle | null> {
  const { folders, file } = splitPath(path)
  const parent = await resolveParent(dir, folders, false)
  if (!parent) return null
  try {
    return await parent.getFileHandle(file)
  } catch (err) {
    if (isAbsent(err)) return null
    throw err
  }
}

/** The directory handle for the folder at `path` if it exists, else `null` —
 * the {@link getExisting} of {@link createFolder}. */
async function getExistingFolder(
  dir: FileSystemDirectoryHandle,
  path: string,
): Promise<FileSystemDirectoryHandle | null> {
  const { folders, file } = splitPath(path)
  const parent = await resolveParent(dir, folders, false)
  if (!parent) return null
  try {
    return await parent.getDirectoryHandle(file)
  } catch (err) {
    if (isAbsent(err)) return null
    throw err
  }
}

/** Split a `/`-separated relative path into its folder segments and leaf file —
 * the single place the path is taken apart, so traversal and the leaf agree. */
function splitPath(path: string): { folders: string[]; file: string } {
  const segments = path.split("/")
  const file = segments.pop() as string // split always yields ≥1 segment
  return { folders: segments, file }
}

/**
 * Walk `dir` into the directory holding the leaf file, one `folders` segment at a
 * time. With `create`, missing folders are materialized (`getDirectoryHandle`
 * with `{ create: true }`); without it, a missing folder — or a segment that
 * names a file, not a folder — returns `null` so the caller treats the note as
 * absent rather than throwing. An empty `folders` (a root-level note) returns
 * `dir` unchanged.
 */
async function resolveParent(
  dir: FileSystemDirectoryHandle,
  folders: string[],
  create: true,
): Promise<FileSystemDirectoryHandle>
async function resolveParent(
  dir: FileSystemDirectoryHandle,
  folders: string[],
  create: boolean,
): Promise<FileSystemDirectoryHandle | null>
async function resolveParent(
  dir: FileSystemDirectoryHandle,
  folders: string[],
  create: boolean,
): Promise<FileSystemDirectoryHandle | null> {
  let current = dir
  for (const folder of folders) {
    try {
      current = await current.getDirectoryHandle(folder, { create })
    } catch (err) {
      if (!create && isAbsent(err)) return null
      throw err
    }
  }
  return current
}

/** True for the errors meaning "nothing usable is at this path": the entry is
 * missing (`NotFoundError`), or a segment names a file where we expected a folder
 * — or vice versa (`TypeMismatchError`). A folder can collide with a like-named
 * file when many tools write the same tree, so we treat that as "no note here"
 * on the read path rather than letting it throw. */
function isAbsent(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name
  return name === "NotFoundError" || name === "TypeMismatchError"
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: unknown }).name === "NotFoundError"
  )
}
