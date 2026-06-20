import { describe, it, expect, vi } from "vitest"
import { readNote, saveNote, listNotes, createNote, deleteNote } from "./note"

interface Entry {
  kind: "file" | "directory"
  content?: string
  lastModified?: number
}

/**
 * A fake directory handle backing several named entries. Supports the file
 * read/write surface (`getFileHandle`/`getFile`/`createWritable`), listing
 * (`values()`), and removal (`removeEntry`). Writes bump `lastModified`.
 */
function fakeFolder(initial: Record<string, Entry> = {}) {
  const entries = new Map<string, Entry>(Object.entries(initial))

  const fileHandleFor = (name: string) => ({
    getFile: vi.fn(async () => {
      const e = entries.get(name)!
      return { lastModified: e.lastModified!, text: async () => e.content! }
    }),
    createWritable: vi.fn(async () => {
      let buf = ""
      return {
        write: async (data: unknown) => {
          buf += String(data)
        },
        close: async () => {
          const prev = entries.get(name)?.lastModified ?? 0
          entries.set(name, { kind: "file", content: buf, lastModified: prev + 1 })
        },
      }
    }),
  })

  const dir = {
    getFileHandle: vi.fn(async (name: string, options?: { create?: boolean }) => {
      const e = entries.get(name)
      if ((!e || e.kind !== "file") && !options?.create) {
        throw new DOMException("not found", "NotFoundError")
      }
      if (!e && options?.create) entries.set(name, { kind: "file", content: "", lastModified: 0 })
      return fileHandleFor(name)
    }),
    removeEntry: vi.fn(async (name: string) => {
      if (!entries.has(name)) throw new DOMException("not found", "NotFoundError")
      entries.delete(name)
    }),
    async *values() {
      for (const [name, e] of entries) yield { kind: e.kind, name }
    },
  } as unknown as FileSystemDirectoryHandle

  return {
    dir,
    content: (name: string) => entries.get(name)?.content ?? null,
    has: (name: string) => entries.has(name),
  }
}

describe("readNote (AC-1, AC-2)", () => {
  it("returns a named file's content and lastModified", async () => {
    const folder = fakeFolder({ "diablo.md": { kind: "file", content: "hello", lastModified: 5 } })
    expect(await readNote(folder.dir, "diablo.md")).toEqual({ content: "hello", lastModified: 5 })
  })

  it("returns empty content and null lastModified when the note is absent", async () => {
    const folder = fakeFolder()
    expect(await readNote(folder.dir, "missing.md")).toEqual({ content: "", lastModified: null })
    expect(folder.has("missing.md")).toBe(false) // read never creates
  })
})

describe("saveNote (AC-3, AC-4)", () => {
  it("creates the named file when absent (first save)", async () => {
    const folder = fakeFolder()
    const result = await saveNote(folder.dir, "new.md", "body", null)
    expect(result.status).toBe("saved")
    expect(folder.content("new.md")).toBe("body")
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

  it("reports a conflict when a file appeared where we saw none", async () => {
    const folder = fakeFolder({ "n.md": { kind: "file", content: "appeared", lastModified: 3 } })
    const result = await saveNote(folder.dir, "n.md", "mine", null)
    expect(result).toEqual({ status: "conflict" })
    expect(folder.content("n.md")).toBe("appeared")
  })
})

describe("listNotes (AC-5, AC-6)", () => {
  it("returns only .md files, sorted case-insensitively, ignoring others", async () => {
    const folder = fakeFolder({
      "Banana.md": { kind: "file", content: "" },
      "apple.md": { kind: "file", content: "" },
      "cherry.MD": { kind: "file", content: "" },
      "notes.txt": { kind: "file", content: "" },
      "sub": { kind: "directory" },
    })
    expect(await listNotes(folder.dir)).toEqual(["apple.md", "Banana.md", "cherry.MD"])
  })

  it("returns an empty list for a folder with no markdown", async () => {
    const folder = fakeFolder({ "readme.txt": { kind: "file", content: "" } })
    expect(await listNotes(folder.dir)).toEqual([])
  })
})

describe("createNote (AC-7, AC-8)", () => {
  it("creates an empty note", async () => {
    const folder = fakeFolder()
    const result = await createNote(folder.dir, "fresh.md")
    expect(result).toEqual({ status: "created" })
    expect(folder.content("fresh.md")).toBe("")
  })

  it("refuses to overwrite an existing note", async () => {
    const folder = fakeFolder({ "fresh.md": { kind: "file", content: "keep me", lastModified: 1 } })
    const result = await createNote(folder.dir, "fresh.md")
    expect(result).toEqual({ status: "exists" })
    expect(folder.content("fresh.md")).toBe("keep me") // untouched
  })
})

describe("deleteNote (AC-9)", () => {
  it("removes the note's file", async () => {
    const folder = fakeFolder({ "gone.md": { kind: "file", content: "x", lastModified: 1 } })
    await deleteNote(folder.dir, "gone.md")
    expect(folder.has("gone.md")).toBe(false)
  })

  it("is a no-op when the note is already gone (many writers)", async () => {
    const folder = fakeFolder()
    await expect(deleteNote(folder.dir, "never.md")).resolves.toBeUndefined()
  })
})
