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

  it("fails before invoking the controller when the captured vault is stale", async () => {
    const stale = new Error("Extension vault is no longer active")
    const assertActive = vi.fn(() => {
      throw stale
    })
    const openNote = vi.fn()
    const source: NavigationAdapterSource = {
      assertActive,
      getActivePath: () => "old.md",
      openNote,
      listNotePaths: vi.fn(async () => ["old.md"]),
      scrollToHeading: vi.fn(),
      expectedFolder: DIR,
    }
    const navigation = createExtensionNavigationAdapter(source)

    await expect(navigation.openNote("new.md")).rejects.toBe(stale)
    expect(openNote).not.toHaveBeenCalled()
  })

  it("does not read the note listing for external or invalid destinations", async () => {
    const listNotePaths = vi.fn(async () => ["current.md"])
    const source: NavigationAdapterSource = {
      assertActive: vi.fn(),
      getActivePath: () => "current.md",
      openNote: vi.fn(),
      listNotePaths,
      scrollToHeading: vi.fn(),
      expectedFolder: DIR,
    }
    const navigation = createExtensionNavigationAdapter(source)

    await expect(navigation.resolveLink("https://example.test", { kind: "markdown" })).resolves.toEqual({
      status: "external",
      target: "https://example.test",
    })
    await expect(navigation.resolveLink("../outside.md", {
      kind: "markdown",
      from: "current.md",
    })).resolves.toEqual({ status: "invalid", target: "../outside.md" })
    expect(listNotePaths).not.toHaveBeenCalled()
  })

  it("resolves relative links against the active-note snapshot taken before listing", async () => {
    let active = "journal/week.md"
    let releaseListing!: () => void
    const listing = new Promise<void>((resolve) => {
      releaseListing = resolve
    })
    const source: NavigationAdapterSource = {
      assertActive: vi.fn(),
      getActivePath: () => active,
      openNote: vi.fn(),
      listNotePaths: vi.fn(async () => {
        await listing
        return ["tasks/today.md"]
      }),
      scrollToHeading: vi.fn(),
      expectedFolder: DIR,
    }
    const navigation = createExtensionNavigationAdapter(source)

    const pending = navigation.resolveLink("../tasks/today.md", { kind: "markdown" })
    active = "other/current.md"
    releaseListing()
    await expect(pending).resolves.toEqual({
      status: "resolved",
      path: "tasks/today.md",
      anchor: null,
    })
  })
})
