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

/** Every `.md` file in the tree as a `/`-separated relative path, sorted
 * case-insensitively by full path. Directories are descended into, not listed. */
export async function listNotes(
  dir: FileSystemDirectoryHandle,
): Promise<string[]> {
  const paths: string[] = []
  await collect(dir, "", paths)
  return paths.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
}

/** Recurse `dir`, pushing `prefix`-qualified relative paths of `.md` files. The
 * async iterator yields the sub-directory handle itself, so we recurse directly. */
async function collect(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  out: string[],
): Promise<void> {
  for await (const entry of dir.values()) {
    if (entry.kind === "file") {
      if (MD_EXT.test(entry.name)) out.push(prefix + entry.name)
    } else {
      await collect(entry, prefix + entry.name + "/", out)
    }
  }
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
