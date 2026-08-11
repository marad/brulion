import { describe, expect, it, vi } from "vitest"
import { createExtensionNavigationAdapter, type NavigationAdapterSource } from "./extension-navigation-adapter"

const DIR = {} as FileSystemDirectoryHandle

describe("extension navigation adapter", () => {
  it("serializes opening and anchoring so each result belongs to the displayed note", async () => {
    let active = "start.md"
    let releaseFirst!: () => void
    const firstFinished = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const openNote = vi.fn(async (path: string) => {
      if (path === "a.md") await firstFinished
      active = path
      return { status: "opened" as const, path }
    })
    const scrollToHeading = vi.fn(() => true)
    const source: NavigationAdapterSource = {
      assertActive: vi.fn(),
      getActivePath: () => active,
      openNote,
      listNotePaths: vi.fn(async () => ["a.md", "b.md", "start.md"]),
      scrollToHeading,
      expectedFolder: DIR,
    }
    const navigation = createExtensionNavigationAdapter(source)

    const first = navigation.openNote("a.md", { anchor: "first" })
    const second = navigation.openNote("b.md", { anchor: "second" })
    await Promise.resolve()
    expect(openNote).toHaveBeenCalledTimes(1)

    releaseFirst()
    await expect(first).resolves.toEqual({
      status: "opened",
      path: "a.md",
      anchor: "first",
      anchorStatus: "found",
    })
    await expect(second).resolves.toEqual({
      status: "opened",
      path: "b.md",
      anchor: "second",
      anchorStatus: "found",
    })
    expect(scrollToHeading).toHaveBeenNthCalledWith(1, "first")
    expect(scrollToHeading).toHaveBeenNthCalledWith(2, "second")
  })

  it("reads the active note through the vault guard", async () => {
    const assertActive = vi.fn()
    const source: NavigationAdapterSource = {
      assertActive,
      getActivePath: () => "notes/current.md",
      openNote: vi.fn(),
      listNotePaths: vi.fn(async () => []),
      scrollToHeading: vi.fn(),
      expectedFolder: DIR,
    }
    const navigation = createExtensionNavigationAdapter(source)

    await expect(navigation.getActiveNote()).resolves.toEqual({ path: "notes/current.md" })
    expect(assertActive).toHaveBeenCalledOnce()
  })
})
