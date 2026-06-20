/**
 * Read, write, list, create, and delete notes — each a `.md` file in the
 * folder the user picked. The folder listing is the source of truth (no index
 * file). The save path guards against silently overwriting a file that changed
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

  const handle = await dir.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  await writable.write(content)
  await writable.close()

  const lastModified = (await handle.getFile()).lastModified
  return { status: "saved", lastModified }
}

/** The folder's `.md` filenames, sorted case-insensitively. */
export async function listNotes(
  dir: FileSystemDirectoryHandle,
): Promise<string[]> {
  const names: string[] = []
  for await (const entry of dir.values()) {
    if (entry.kind === "file" && MD_EXT.test(entry.name)) names.push(entry.name)
  }
  return names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
}

/**
 * Create an empty `name`. If a file already exists it is left untouched and
 * `{ status: "exists" }` is returned, so a name clash never clobbers content.
 */
export async function createNote(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<CreateResult> {
  if (await getExisting(dir, name)) return { status: "exists" }
  const handle = await dir.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  await writable.close() // materialize an empty file
  return { status: "created" }
}

/** Remove `name` from the folder. */
export async function deleteNote(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<void> {
  await dir.removeEntry(name)
}

/** The file handle for `name` if it exists, else `null`. */
async function getExisting(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<FileSystemFileHandle | null> {
  try {
    return await dir.getFileHandle(name)
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: unknown }).name === "NotFoundError"
  )
}
