import { describe, it, expect, vi, afterEach } from "vitest"
import { pickFolder, listMarkdownFiles } from "./fs"

type FakeEntry = { kind: "file" | "directory"; name: string }

function fakeDir(entries: FakeEntry[]): FileSystemDirectoryHandle {
  return {
    async *values() {
      for (const entry of entries) yield entry
    },
  } as unknown as FileSystemDirectoryHandle
}

describe("listMarkdownFiles", () => {
  it("keeps only .md file entries, sorted, ignoring case and sub-directories", async () => {
    const dir = fakeDir([
      { kind: "file", name: "zebra.md" },
      { kind: "file", name: "notes.txt" },
      { kind: "file", name: "Alpha.MD" },
      { kind: "directory", name: "archive.md" },
      { kind: "file", name: "beta.md" },
    ])

    expect(await listMarkdownFiles(dir)).toEqual(["Alpha.MD", "beta.md", "zebra.md"])
  })

  it("returns an empty list for a folder with no markdown", async () => {
    const dir = fakeDir([
      { kind: "file", name: "a.txt" },
      { kind: "directory", name: "sub" },
    ])

    expect(await listMarkdownFiles(dir)).toEqual([])
  })
})

describe("pickFolder", () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).showDirectoryPicker
  })

  it("returns the directory handle on success, requesting readwrite", async () => {
    const handle = { kind: "directory", name: "root" }
    const picker = vi.fn().mockResolvedValue(handle)
    ;(window as unknown as Record<string, unknown>).showDirectoryPicker = picker

    expect(await pickFolder()).toBe(handle)
    expect(picker).toHaveBeenCalledWith({ mode: "readwrite" })
  })

  it("returns null when the picker is dismissed (AbortError)", async () => {
    ;(window as unknown as Record<string, unknown>).showDirectoryPicker = vi
      .fn()
      .mockRejectedValue(new DOMException("user aborted", "AbortError"))

    expect(await pickFolder()).toBeNull()
  })

  it("treats any AbortError-named rejection as dismissal, even non-DOMException", async () => {
    ;(window as unknown as Record<string, unknown>).showDirectoryPicker = vi
      .fn()
      .mockRejectedValue({ name: "AbortError", message: "polyfill abort" })

    expect(await pickFolder()).toBeNull()
  })

  it("rethrows non-abort errors", async () => {
    ;(window as unknown as Record<string, unknown>).showDirectoryPicker = vi
      .fn()
      .mockRejectedValue(new DOMException("boom", "NotAllowedError"))

    await expect(pickFolder()).rejects.toThrow("boom")
  })
})
