import { describe, it, expect, vi } from "vitest"
import { readNote, saveNote } from "./note"

/**
 * A fake directory handle backing a single `start.md`. `initial` seeds an
 * existing file; omit it for an empty folder. Tracks writes and bumps
 * lastModified on close.
 */
function fakeFolder(initial?: { content: string; lastModified: number }) {
  let file = initial ? { ...initial } : null
  const writes: string[] = []

  const fileHandle = {
    getFile: vi.fn(async () => ({
      lastModified: file!.lastModified,
      text: async () => file!.content,
    })),
    createWritable: vi.fn(async () => ({
      write: async (data: unknown) => {
        writes.push(String(data))
      },
      close: async () => {
        file = { content: writes.join(""), lastModified: (file?.lastModified ?? 0) + 1 }
      },
    })),
  }

  const dir = {
    getFileHandle: vi.fn(async (_name: string, options?: { create?: boolean }) => {
      if (!file && !options?.create) {
        throw new DOMException("not found", "NotFoundError")
      }
      if (!file && options?.create) file = { content: "", lastModified: 0 }
      return fileHandle
    }),
  } as unknown as FileSystemDirectoryHandle

  return {
    dir,
    writes,
    get content() {
      return file?.content ?? null
    },
    get lastModified() {
      return file?.lastModified ?? null
    },
    bumpExternally(content: string) {
      file = { content, lastModified: (file?.lastModified ?? 0) + 100 }
    },
  }
}

describe("readNote", () => {
  it("returns an existing file's content and lastModified", async () => {
    const folder = fakeFolder({ content: "hello", lastModified: 5 })
    expect(await readNote(folder.dir)).toEqual({ content: "hello", lastModified: 5 })
  })

  it("returns empty content and null lastModified when start.md is absent", async () => {
    const folder = fakeFolder()
    expect(await readNote(folder.dir)).toEqual({ content: "", lastModified: null })
  })
})

describe("saveNote", () => {
  it("creates start.md when absent (first save)", async () => {
    const folder = fakeFolder()
    const result = await saveNote(folder.dir, "new note", null)
    expect(result.status).toBe("saved")
    expect(folder.content).toBe("new note")
  })

  it("overwrites when the on-disk lastModified matches what we last saw", async () => {
    const folder = fakeFolder({ content: "old", lastModified: 7 })
    const result = await saveNote(folder.dir, "updated", 7)
    expect(result).toEqual({ status: "saved", lastModified: 8 })
    expect(folder.content).toBe("updated")
  })

  it("reports a conflict and does not write when the file changed under us", async () => {
    const folder = fakeFolder({ content: "theirs", lastModified: 9 })
    const result = await saveNote(folder.dir, "mine", 7)
    expect(result).toEqual({ status: "conflict" })
    expect(folder.content).toBe("theirs") // untouched
    expect(folder.writes).toEqual([])
  })

  it("reports a conflict when a file appeared where we saw none", async () => {
    const folder = fakeFolder({ content: "appeared", lastModified: 3 })
    const result = await saveNote(folder.dir, "mine", null)
    expect(result).toEqual({ status: "conflict" })
    expect(folder.content).toBe("appeared")
  })
})
