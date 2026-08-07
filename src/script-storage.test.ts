import { describe, expect, it } from "vitest"
import {
  MAX_SCRIPT_SOURCE_BYTES,
  ScriptStorageError,
  createScript,
  deleteScript,
  listScripts,
  readScript,
  writeScriptSource,
} from "./script-storage"
import type { ScriptManifest } from "./script-manifest"

type FileNode = { kind: "file"; content: string; lastModified: number }
type DirNode = { kind: "directory"; entries: Map<string, Node> }
type Node = FileNode | DirNode

function notFound(): never {
  throw new DOMException("not found", "NotFoundError")
}

function typeMismatch(): never {
  throw new DOMException("type mismatch", "TypeMismatchError")
}

function makeDir(entries: Map<string, Node>, name = ""): FileSystemDirectoryHandle {
  const fileHandle = (fileName: string): FileSystemFileHandle =>
    ({
      kind: "file",
      name: fileName,
      getFile: async () => {
        const node = entries.get(fileName)
        if (!node || node.kind !== "file") return notFound()
        return { lastModified: node.lastModified, text: async () => node.content }
      },
      createWritable: async () => {
        let content = ""
        return {
          write: async (value: unknown) => {
            content = String(value)
          },
          close: async () => {
            const previous = entries.get(fileName)
            const mtime = previous?.kind === "file" ? previous.lastModified + 1 : 1
            entries.set(fileName, { kind: "file", content, lastModified: mtime })
          },
        }
      },
    }) as unknown as FileSystemFileHandle

  return {
    kind: "directory",
    name,
    getFileHandle: async (fileName: string, options?: { create?: boolean }) => {
      const node = entries.get(fileName)
      if (node?.kind === "directory") return typeMismatch()
      if (!node && !options?.create) return notFound()
      if (!node) entries.set(fileName, { kind: "file", content: "", lastModified: 0 })
      return fileHandle(fileName)
    },
    getDirectoryHandle: async (dirName: string, options?: { create?: boolean }) => {
      const node = entries.get(dirName)
      if (node?.kind === "file") return typeMismatch()
      if (!node && !options?.create) return notFound()
      if (!node) entries.set(dirName, { kind: "directory", entries: new Map() })
      return makeDir((entries.get(dirName) as DirNode).entries, dirName)
    },
    removeEntry: async (entryName: string) => {
      if (!entries.has(entryName)) return notFound()
      entries.delete(entryName)
    },
    async *values() {
      for (const [entryName, node] of entries) {
        yield node.kind === "file"
          ? fileHandle(entryName)
          : makeDir(node.entries, entryName)
      }
    },
  } as unknown as FileSystemDirectoryHandle
}

function fakeFolder(): {
  dir: FileSystemDirectoryHandle
  has: (path: string) => boolean
  content: (path: string) => string | null
  touch: (path: string, content?: string) => void
} {
  const root: DirNode = { kind: "directory", entries: new Map() }
  const resolve = (path: string): Node | undefined => {
    const segments = path.split("/")
    let current: Node = root
    for (const segment of segments) {
      if (current.kind !== "directory") return undefined
      current = current.entries.get(segment) as Node
      if (!current) return undefined
    }
    return current
  }
  const touch = (path: string, content = "") => {
    const segments = path.split("/")
    const file = segments.pop() as string
    let current = root
    for (const segment of segments) {
      const existing = current.entries.get(segment)
      if (existing?.kind === "file") return typeMismatch()
      if (!existing) current.entries.set(segment, { kind: "directory", entries: new Map() })
      current = current.entries.get(segment) as DirNode
    }
    const old = current.entries.get(file)
    current.entries.set(file, {
      kind: "file",
      content,
      lastModified: old?.kind === "file" ? old.lastModified + 1 : 1,
    })
  }
  return {
    dir: makeDir(root.entries),
    has: (path) => resolve(path) !== undefined,
    content: (path) => {
      const node = resolve(path)
      return node?.kind === "file" ? node.content : null
    },
    touch,
  }
}

const manifest: ScriptManifest = {
  schemaVersion: 1,
  apiVersion: 1,
  id: "daily-tools",
  name: "Daily tools",
  version: "0.1.0",
  entry: "main.js",
  permissions: ["commands"],
}

describe("script storage (FEAT-0082)", () => {
  it("does not create the metadata directory while discovering an empty vault", async () => {
    const folder = fakeFolder()

    expect(await listScripts(folder.dir)).toEqual([])
    expect(folder.has(".brulion")).toBe(false)
  })

  it("creates, discovers, and reads a script with source and manifest mtimes", async () => {
    const folder = fakeFolder()
    expect(await createScript(folder.dir, manifest, "export const answer = 42")).toEqual({ status: "created" })

    const discovered = await listScripts(folder.dir)
    expect(discovered).toHaveLength(1)
    expect(discovered[0]).toMatchObject({ id: "daily-tools", manifest })

    const script = await readScript(folder.dir, "daily-tools")
    expect(script).toMatchObject({ manifest, source: "export const answer = 42" })
    expect(script.sourceLastModified).toBeGreaterThan(0)
    expect(script.manifestLastModified).toBeGreaterThan(0)
  })

  it("keeps malformed folders observable without hiding valid scripts", async () => {
    const folder = fakeFolder()
    await createScript(folder.dir, manifest, "ok")
    folder.touch(".brulion/scripts/broken/manifest.json", "{not json")
    folder.touch(".brulion/scripts/README.txt", "ignore")

    const scripts = await listScripts(folder.dir)
    expect(scripts.map((script) => script.id)).toEqual(["broken", "daily-tools"])
    expect(scripts[0]).toMatchObject({ id: "broken", manifest: null })
    expect(scripts[0].error).toMatch(/JSON/)
  })

  it("guards source writes against an external mtime change", async () => {
    const folder = fakeFolder()
    await createScript(folder.dir, manifest, "mine")
    const before = await readScript(folder.dir, "daily-tools")

    expect(await writeScriptSource(folder.dir, "daily-tools", "updated", before.sourceLastModified)).toMatchObject({
      status: "saved",
    })
    expect(folder.content(".brulion/scripts/daily-tools/main.js")).toBe("updated")

    const current = await readScript(folder.dir, "daily-tools")
    folder.touch(".brulion/scripts/daily-tools/main.js", "external")
    expect(await writeScriptSource(folder.dir, "daily-tools", "clobber", current.sourceLastModified)).toEqual({
      status: "conflict",
    })
    expect(folder.content(".brulion/scripts/daily-tools/main.js")).toBe("external")
  })

  it("rejects invalid ids, oversized sources, and missing scripts before writing", async () => {
    const folder = fakeFolder()
    await expect(writeScriptSource(folder.dir, "../escape", "x", null)).rejects.toMatchObject({
      code: "invalid_id",
    })
    await expect(createScript(folder.dir, manifest, "x".repeat(MAX_SCRIPT_SOURCE_BYTES + 1))).rejects.toMatchObject({
      code: "source_too_large",
    })
    expect(folder.has(".brulion")).toBe(false)
    await expect(readScript(folder.dir, "missing")).rejects.toMatchObject({ code: "missing" })
  })

  it("reports a directory conflict when an id is occupied by a file", async () => {
    const folder = fakeFolder()
    folder.touch(".brulion/scripts/daily-tools", "not a directory")

    await expect(createScript(folder.dir, manifest, "source")).rejects.toMatchObject({
      code: "directory_conflict",
    })
  })

  it("deletes only the validated script directory", async () => {
    const folder = fakeFolder()
    await createScript(folder.dir, manifest, "source")
    await expect(deleteScript(folder.dir, "../daily-tools")).rejects.toBeInstanceOf(ScriptStorageError)
    await deleteScript(folder.dir, "daily-tools")
    expect(folder.has(".brulion/scripts/daily-tools")).toBe(false)
    expect(folder.has(".brulion/scripts")).toBe(true)
  })
})
