import {
  parseScriptManifest,
  parseScriptManifestText,
  validateScriptId,
  type ScriptManifest,
} from "./script-manifest"

/** The vault-relative metadata directory and extension directory. */
export const BRULION_DIRECTORY = ".brulion"
export const SCRIPTS_DIRECTORY = "scripts"
export const MANIFEST_FILE = "manifest.json"

/** Maximum UTF-8 source size accepted for one local MVP script. */
export const MAX_SCRIPT_SOURCE_BYTES = 512 * 1024

export interface ScriptRecord {
  manifest: ScriptManifest
  source: string
  sourceLastModified: number
  manifestLastModified: number
}

export interface ScriptDiscovery {
  /** The directory name on disk; invalid ids remain observable in this list. */
  id: string
  manifest: ScriptManifest | null
  manifestLastModified: number | null
  error?: string
}

export type ScriptWriteResult =
  | { status: "saved"; lastModified: number }
  | { status: "conflict" }

export type CreateScriptResult = { status: "created" } | { status: "exists" }

export type ScriptStorageErrorCode =
  | "invalid_id"
  | "missing"
  | "invalid_manifest"
  | "entry_missing"
  | "source_too_large"
  | "directory_conflict"

export class ScriptStorageError extends Error {
  readonly code: ScriptStorageErrorCode

  constructor(code: ScriptStorageErrorCode, message: string) {
    super(message)
    this.name = "ScriptStorageError"
    this.code = code
  }
}

function isMissing(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name
  return name === "NotFoundError" || name === "TypeMismatchError"
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength
}

function assertSourceSize(source: string): void {
  if (byteLength(source) > MAX_SCRIPT_SOURCE_BYTES) {
    throw new ScriptStorageError(
      "source_too_large",
      `Script source exceeds the ${MAX_SCRIPT_SOURCE_BYTES}-byte limit.`,
    )
  }
}

function assertId(id: string): void {
  const result = validateScriptId(id)
  if (!result.ok) throw new ScriptStorageError("invalid_id", result.error)
}

async function scriptsDirectory(
  root: FileSystemDirectoryHandle,
  create: boolean,
): Promise<FileSystemDirectoryHandle | null> {
  try {
    const metadata = await root.getDirectoryHandle(BRULION_DIRECTORY, { create })
    return await metadata.getDirectoryHandle(SCRIPTS_DIRECTORY, { create })
  } catch (error) {
    if (!create && isMissing(error)) return null
    if (create && isMissing(error)) {
      throw new ScriptStorageError(
        "directory_conflict",
        "The .brulion metadata path is occupied by a file.",
      )
    }
    throw error
  }
}

function splitPath(path: string): { folders: string[]; file: string } {
  const segments = path.split("/")
  const file = segments.pop() as string
  return { folders: segments, file }
}

async function resolveParent(
  dir: FileSystemDirectoryHandle,
  folders: string[],
  create: boolean,
): Promise<FileSystemDirectoryHandle | null> {
  let current = dir
  for (const folder of folders) {
    try {
      current = await current.getDirectoryHandle(folder, { create })
    } catch (error) {
      if (!create && isMissing(error)) return null
      throw error
    }
  }
  return current
}

async function getFile(
  dir: FileSystemDirectoryHandle,
  path: string,
  createParent: boolean,
): Promise<FileSystemFileHandle | null> {
  const { folders, file } = splitPath(path)
  const parent = await resolveParent(dir, folders, createParent)
  if (!parent) return null
  try {
    return await parent.getFileHandle(file, { create: false })
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }
}

async function readFile(
  dir: FileSystemDirectoryHandle,
  path: string,
): Promise<{ text: string; lastModified: number } | null> {
  const handle = await getFile(dir, path, false)
  if (!handle) return null
  const file = await handle.getFile()
  return { text: await file.text(), lastModified: file.lastModified }
}

async function writeFile(
  dir: FileSystemDirectoryHandle,
  path: string,
  text: string,
): Promise<number> {
  const { folders, file } = splitPath(path)
  const parent = await resolveParent(dir, folders, true)
  if (!parent) throw new ScriptStorageError("directory_conflict", "Script parent directory is unavailable.")
  const handle = await parent.getFileHandle(file, { create: true })
  const writable = await handle.createWritable()
  await writable.write(text)
  await writable.close()
  return (await handle.getFile()).lastModified
}

async function readManifest(
  scriptDir: FileSystemDirectoryHandle,
): Promise<{ manifest: ScriptManifest; lastModified: number }> {
  const stored = await readFile(scriptDir, MANIFEST_FILE)
  if (!stored) throw new ScriptStorageError("invalid_manifest", "Script manifest.json is missing.")
  const parsed = parseScriptManifestText(stored.text)
  if (!parsed.ok) throw new ScriptStorageError("invalid_manifest", parsed.error)
  return { manifest: parsed.manifest, lastModified: stored.lastModified }
}

async function getScriptDirectory(
  root: FileSystemDirectoryHandle,
  id: string,
  create: boolean,
): Promise<FileSystemDirectoryHandle | null> {
  const scripts = await scriptsDirectory(root, create)
  if (!scripts) return null
  try {
    return await scripts.getDirectoryHandle(id, { create })
  } catch (error) {
    if (!create && isMissing(error)) return null
    if (create && isMissing(error)) {
      throw new ScriptStorageError("directory_conflict", `Script path is occupied: ${id}`)
    }
    throw error
  }
}

/** List script folders without creating `.brulion` or any child directory. */
export async function listScripts(root: FileSystemDirectoryHandle): Promise<ScriptDiscovery[]> {
  const scripts = await scriptsDirectory(root, false)
  if (!scripts) return []
  const result: ScriptDiscovery[] = []
  for await (const entry of scripts.values()) {
    if (entry.kind !== "directory") continue
    const id = entry.name
    const validId = validateScriptId(id)
    if (!validId.ok) {
      result.push({ id, manifest: null, manifestLastModified: null, error: validId.error })
      continue
    }
    try {
      const parsed = await readManifest(entry)
      if (parsed.manifest.id !== id) {
        throw new ScriptStorageError("invalid_manifest", "Manifest id does not match its directory.")
      }
      result.push({ id, manifest: parsed.manifest, manifestLastModified: parsed.lastModified })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to read script manifest."
      result.push({ id, manifest: null, manifestLastModified: null, error: message })
    }
  }
  return result.sort((a, b) => a.id.localeCompare(b.id, undefined, { sensitivity: "base" }))
}

/** Read a validated script's manifest and JavaScript entry source. */
export async function readScript(root: FileSystemDirectoryHandle, id: string): Promise<ScriptRecord> {
  assertId(id)
  const scriptDir = await getScriptDirectory(root, id, false)
  if (!scriptDir) throw new ScriptStorageError("missing", `Script not found: ${id}`)
  const storedManifest = await readManifest(scriptDir)
  if (storedManifest.manifest.id !== id) {
    throw new ScriptStorageError("invalid_manifest", "Manifest id does not match its directory.")
  }
  const source = await readFile(scriptDir, storedManifest.manifest.entry)
  if (!source) throw new ScriptStorageError("entry_missing", "Script entry file is missing.")
  assertSourceSize(source.text)
  return {
    manifest: storedManifest.manifest,
    source: source.text,
    sourceLastModified: source.lastModified,
    manifestLastModified: storedManifest.lastModified,
  }
}

/** Create a new script; an existing id is never overwritten. */
export async function createScript(
  root: FileSystemDirectoryHandle,
  rawManifest: unknown,
  source: string,
): Promise<CreateScriptResult> {
  const parsed = parseScriptManifest(rawManifest)
  if (!parsed.ok) throw new ScriptStorageError("invalid_manifest", parsed.error)
  assertSourceSize(source)
  const scripts = await scriptsDirectory(root, true)
  if (!scripts) throw new ScriptStorageError("directory_conflict", "Script directory is unavailable.")
  try {
    await scripts.getDirectoryHandle(parsed.manifest.id, { create: false })
    return { status: "exists" }
  } catch (error) {
    if (!isMissing(error)) throw error
    if ((error as { name?: unknown }).name === "TypeMismatchError") {
      throw new ScriptStorageError(
        "directory_conflict",
        `Script path is occupied by a file: ${parsed.manifest.id}`,
      )
    }
  }
  const scriptDir = await scripts.getDirectoryHandle(parsed.manifest.id, { create: true })
  // FSA has no multi-file transaction. Write source first and publish the manifest
  // last, so discovery never treats a half-written entry as runnable metadata.
  await writeFile(scriptDir, parsed.manifest.entry, source)
  await writeFile(scriptDir, MANIFEST_FILE, JSON.stringify(parsed.manifest, null, 2))
  return { status: "created" }
}

/** Save one entry file while preserving the caller's last-seen mtime guard. */
export async function writeScriptSource(
  root: FileSystemDirectoryHandle,
  id: string,
  source: string,
  expectedLastModified: number | null,
): Promise<ScriptWriteResult> {
  assertId(id)
  assertSourceSize(source)
  const scriptDir = await getScriptDirectory(root, id, false)
  if (!scriptDir) throw new ScriptStorageError("missing", `Script not found: ${id}`)
  const storedManifest = await readManifest(scriptDir)
  if (storedManifest.manifest.id !== id) {
    throw new ScriptStorageError("invalid_manifest", "Manifest id does not match its directory.")
  }
  const current = await readFile(scriptDir, storedManifest.manifest.entry)
  if (current) {
    if (expectedLastModified === null || current.lastModified !== expectedLastModified) {
      return { status: "conflict" }
    }
  } else if (expectedLastModified !== null) {
    return { status: "conflict" }
  }
  const lastModified = await writeFile(scriptDir, storedManifest.manifest.entry, source)
  return { status: "saved", lastModified }
}

/** Explicitly remove one script directory; missing scripts are already gone. */
export async function deleteScript(root: FileSystemDirectoryHandle, id: string): Promise<void> {
  assertId(id)
  const scripts = await scriptsDirectory(root, false)
  if (!scripts) return
  try {
    await scripts.removeEntry(id, { recursive: true })
  } catch (error) {
    if (!isMissing(error)) throw error
  }
}
