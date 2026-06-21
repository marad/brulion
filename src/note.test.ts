import { describe, it, expect } from "vitest"
import { readNote, saveNote, listNotes, createNote, deleteNote, statNote } from "./note"

type FileNode = { kind: "file"; content: string; lastModified: number }
type DirNode = { kind: "directory"; entries: Map<string, Node> }
type Node = FileNode | DirNode

/** Initial-tree shape: a file (with optional mtime) or a directory with children. */
type Spec =
  | { kind: "file"; content?: string; lastModified?: number }
  | { kind: "directory"; children?: Record<string, Spec> }

function toEntries(rec: Record<string, Spec>): Map<string, Node> {
  const m = new Map<string, Node>()
  for (const [name, v] of Object.entries(rec)) {
    if (v.kind === "directory") {
      m.set(name, { kind: "directory", entries: toEntries(v.children ?? {}) })
    } else {
      m.set(name, { kind: "file", content: v.content ?? "", lastModified: v.lastModified ?? 0 })
    }
  }
  return m
}

function notFound(): never {
  throw new DOMException("not found", "NotFoundError")
}

/**
 * A fake directory handle backing a nested tree. Supports the file read/write
 * surface, sub-directory traversal (`getDirectoryHandle`, with `{ create }`),
 * recursive listing (`values()` yields real file/dir handles), and removal.
 * Writes bump `lastModified`.
 */
function makeDirHandle(entries: Map<string, Node>, name = ""): FileSystemDirectoryHandle {
  const fileHandleFor = (fname: string) => ({
    kind: "file" as const,
    name: fname,
    getFile: async () => {
      const e = entries.get(fname) as FileNode
      return { lastModified: e.lastModified, text: async () => e.content }
    },
    createWritable: async () => {
      let buf = ""
      return {
        write: async (data: unknown) => {
          buf += String(data)
        },
        close: async () => {
          const prev = (entries.get(fname) as FileNode | undefined)?.lastModified ?? 0
          entries.set(fname, { kind: "file", content: buf, lastModified: prev + 1 })
        },
      }
    },
  })

  const handle = {
    kind: "directory" as const,
    name,
    getFileHandle: async (fname: string, options?: { create?: boolean }) => {
      const e = entries.get(fname)
      if ((!e || e.kind !== "file") && !options?.create) notFound()
      if (!e && options?.create) entries.set(fname, { kind: "file", content: "", lastModified: 0 })
      return fileHandleFor(fname)
    },
    getDirectoryHandle: async (dname: string, options?: { create?: boolean }) => {
      let e = entries.get(dname)
      if (!e || e.kind !== "directory") {
        if (!options?.create) notFound()
        e = { kind: "directory", entries: new Map<string, Node>() }
        entries.set(dname, e)
      }
      return makeDirHandle(e.entries, dname)
    },
    removeEntry: async (ename: string) => {
      if (!entries.has(ename)) notFound()
      entries.delete(ename)
    },
    async *values() {
      for (const [n, e] of entries) {
        yield e.kind === "file" ? fileHandleFor(n) : makeDirHandle(e.entries, n)
      }
    },
  }
  return handle as unknown as FileSystemDirectoryHandle
}

function fakeFolder(initial: Record<string, Spec> = {}) {
  const root = toEntries(initial)

  // Resolve a path to its node by walking the tree, or undefined if any segment
  // is missing / not the expected kind.
  const nodeAt = (path: string): Node | undefined => {
    const parts = path.split("/")
    let map = root
    for (let i = 0; i < parts.length - 1; i++) {
      const d = map.get(parts[i])
      if (!d || d.kind !== "directory") return undefined
      map = d.entries
    }
    return map.get(parts[parts.length - 1])
  }

  return {
    dir: makeDirHandle(root),
    content: (path: string) => {
      const n = nodeAt(path)
      return n?.kind === "file" ? n.content : null
    },
    has: (path: string) => nodeAt(path) !== undefined,
  }
}

describe("readNote (AC-1, AC-2)", () => {
  it("returns a named file's content and lastModified", async () => {
    const folder = fakeFolder({ "diablo.md": { kind: "file", content: "hello", lastModified: 5 } })
    expect(await readNote(folder.dir, "diablo.md")).toEqual({ content: "hello", lastModified: 5 })
  })

  it("reads a nested note by path (AC-1)", async () => {
    const folder = fakeFolder({
      sub: { kind: "directory", children: { "b.md": { kind: "file", content: "deep", lastModified: 3 } } },
    })
    expect(await readNote(folder.dir, "sub/b.md")).toEqual({ content: "deep", lastModified: 3 })
  })

  it("returns empty content and null lastModified when the note is absent", async () => {
    const folder = fakeFolder()
    expect(await readNote(folder.dir, "missing.md")).toEqual({ content: "", lastModified: null })
    expect(folder.has("missing.md")).toBe(false) // read never creates
  })

  it("reads empty when an intermediate folder is missing, creating nothing (AC-2)", async () => {
    const folder = fakeFolder()
    expect(await readNote(folder.dir, "sub/x.md")).toEqual({ content: "", lastModified: null })
    expect(folder.has("sub")).toBe(false)
  })
})

describe("saveNote (AC-3, AC-4)", () => {
  it("creates the named file when absent (first save)", async () => {
    const folder = fakeFolder()
    const result = await saveNote(folder.dir, "new.md", "body", null)
    expect(result.status).toBe("saved")
    expect(folder.content("new.md")).toBe("body")
  })

  it("creates intermediate folders when saving a nested note (AC-3)", async () => {
    const folder = fakeFolder()
    const result = await saveNote(folder.dir, "sub/deep/n.md", "body", null)
    expect(result.status).toBe("saved")
    expect(folder.content("sub/deep/n.md")).toBe("body")
  })

  it("overwrites when the on-disk lastModified matches what we last saw", async () => {
    const folder = fakeFolder({ "n.md": { kind: "file", content: "old", lastModified: 7 } })
    const result = await saveNote(folder.dir, "n.md", "updated", 7)
    expect(result).toEqual({ status: "saved", lastModified: 8 })
    expect(folder.content("n.md")).toBe("updated")
  })

  it("reports a conflict and does not write when the file changed under us", async () => {
    const folder = fakeFolder({ "n.md": { kind: "file", content: "theirs", lastModified: 9 } })
    const result = await saveNote(folder.dir, "n.md", "mine", 7)
    expect(result).toEqual({ status: "conflict" })
    expect(folder.content("n.md")).toBe("theirs")
  })

  it("preserves the per-note guard for a nested note (AC-4)", async () => {
    const folder = fakeFolder({
      sub: { kind: "directory", children: { "n.md": { kind: "file", content: "theirs", lastModified: 9 } } },
    })
    const result = await saveNote(folder.dir, "sub/n.md", "mine", 7)
    expect(result).toEqual({ status: "conflict" })
    expect(folder.content("sub/n.md")).toBe("theirs")
  })

  it("reports a conflict when a file appeared where we saw none", async () => {
    const folder = fakeFolder({ "n.md": { kind: "file", content: "appeared", lastModified: 3 } })
    const result = await saveNote(folder.dir, "n.md", "mine", null)
    expect(result).toEqual({ status: "conflict" })
    expect(folder.content("n.md")).toBe("appeared")
  })
})

describe("listNotes (AC-5, AC-6)", () => {
  it("recurses the tree, returning sorted relative paths, ignoring non-markdown", async () => {
    const folder = fakeFolder({
      "a.md": { kind: "file", content: "" },
      "notes.txt": { kind: "file", content: "" },
      empty: { kind: "directory" },
      sub: {
        kind: "directory",
        children: {
          "b.md": { kind: "file", content: "" },
          deep: { kind: "directory", children: { "c.md": { kind: "file", content: "" } } },
        },
      },
    })
    expect(await listNotes(folder.dir)).toEqual(["a.md", "sub/b.md", "sub/deep/c.md"])
  })

  it("sorts case-insensitively by full path", async () => {
    const folder = fakeFolder({
      "Banana.md": { kind: "file", content: "" },
      "apple.md": { kind: "file", content: "" },
      "cherry.MD": { kind: "file", content: "" },
    })
    expect(await listNotes(folder.dir)).toEqual(["apple.md", "Banana.md", "cherry.MD"])
  })

  it("returns an empty list for a folder with no markdown", async () => {
    const folder = fakeFolder({ "readme.txt": { kind: "file", content: "" } })
    expect(await listNotes(folder.dir)).toEqual([])
  })
})

describe("createNote (AC-6, AC-7, AC-8)", () => {
  it("creates an empty note", async () => {
    const folder = fakeFolder()
    const result = await createNote(folder.dir, "fresh.md")
    expect(result).toEqual({ status: "created" })
    expect(folder.content("fresh.md")).toBe("")
  })

  it("creates a nested note, materializing its folders (AC-6)", async () => {
    const folder = fakeFolder()
    const result = await createNote(folder.dir, "sub/fresh.md")
    expect(result).toEqual({ status: "created" })
    expect(folder.content("sub/fresh.md")).toBe("")
  })

  it("refuses to overwrite an existing nested note (AC-7)", async () => {
    const folder = fakeFolder({
      sub: { kind: "directory", children: { "fresh.md": { kind: "file", content: "keep me", lastModified: 1 } } },
    })
    const result = await createNote(folder.dir, "sub/fresh.md")
    expect(result).toEqual({ status: "exists" })
    expect(folder.content("sub/fresh.md")).toBe("keep me") // untouched
  })
})

describe("deleteNote (AC-8)", () => {
  it("removes a nested note's file, leaving its folder", async () => {
    const folder = fakeFolder({
      sub: { kind: "directory", children: { "gone.md": { kind: "file", content: "x", lastModified: 1 } } },
    })
    await deleteNote(folder.dir, "sub/gone.md")
    expect(folder.has("sub/gone.md")).toBe(false)
    expect(folder.has("sub")).toBe(true)
  })

  it("is a no-op when the note is already gone (many writers)", async () => {
    const folder = fakeFolder()
    await expect(deleteNote(folder.dir, "never.md")).resolves.toBeUndefined()
  })

  it("is a no-op when an intermediate folder is missing", async () => {
    const folder = fakeFolder()
    await expect(deleteNote(folder.dir, "sub/never.md")).resolves.toBeUndefined()
  })
})

describe("statNote", () => {
  it("returns a nested file's lastModified", async () => {
    const folder = fakeFolder({
      sub: { kind: "directory", children: { "n.md": { kind: "file", content: "x", lastModified: 42 } } },
    })
    expect(await statNote(folder.dir, "sub/n.md")).toBe(42)
  })

  it("returns null when the file does not exist", async () => {
    const folder = fakeFolder()
    expect(await statNote(folder.dir, "missing.md")).toBeNull()
  })
})
