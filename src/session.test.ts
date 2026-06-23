import { describe, it, expect, vi, beforeEach } from "vitest"
import * as idb from "idb-keyval"
import {
  saveFolder,
  loadFolder,
  hasPermission,
  requestAccess,
  saveActiveNote,
  loadActiveNote,
  saveSidebarCollapsed,
  loadSidebarCollapsed,
  saveExpandedFolders,
  loadExpandedFolders,
  saveSidebarWidth,
  loadSidebarWidth,
  saveRecency,
  loadRecency,
} from "./session"

vi.mock("idb-keyval", () => ({
  get: vi.fn(),
  set: vi.fn(),
}))

const get = vi.mocked(idb.get)
const set = vi.mocked(idb.set)

function handleWith(perm: {
  query?: PermissionState
  request?: PermissionState
}): FileSystemDirectoryHandle {
  return {
    queryPermission: vi.fn().mockResolvedValue(perm.query),
    requestPermission: vi.fn().mockResolvedValue(perm.request),
  } as unknown as FileSystemDirectoryHandle
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("saveFolder / loadFolder", () => {
  it("saves the handle under a stable key", async () => {
    const handle = { kind: "directory" } as FileSystemDirectoryHandle
    await saveFolder(handle)
    expect(set).toHaveBeenCalledWith("brulion:dir", handle)
  })

  it("loads from the same key", async () => {
    const handle = { kind: "directory" } as FileSystemDirectoryHandle
    get.mockResolvedValue(handle)
    expect(await loadFolder()).toBe(handle)
    expect(get).toHaveBeenCalledWith("brulion:dir")
  })

  it("returns undefined when nothing is stored", async () => {
    get.mockResolvedValue(undefined)
    expect(await loadFolder()).toBeUndefined()
  })
})

describe("saveActiveNote / loadActiveNote", () => {
  it("saves the active note's filename under its own key", async () => {
    await saveActiveNote("diablo.md")
    expect(set).toHaveBeenCalledWith("brulion:active", "diablo.md")
  })

  it("loads from the same key", async () => {
    get.mockResolvedValue("diablo.md")
    expect(await loadActiveNote()).toBe("diablo.md")
    expect(get).toHaveBeenCalledWith("brulion:active")
  })

  it("returns undefined when no active note is stored", async () => {
    get.mockResolvedValue(undefined)
    expect(await loadActiveNote()).toBeUndefined()
  })
})

describe("saveSidebarCollapsed / loadSidebarCollapsed", () => {
  it("saves the flag under a stable key (FEAT-0020 AC-4)", async () => {
    await saveSidebarCollapsed(true)
    expect(set).toHaveBeenCalledWith("brulion:sidebar-collapsed", true)
    await saveSidebarCollapsed(false)
    expect(set).toHaveBeenCalledWith("brulion:sidebar-collapsed", false)
  })

  it("loads the stored flag", async () => {
    get.mockResolvedValue(true)
    expect(await loadSidebarCollapsed()).toBe(true)
    expect(get).toHaveBeenCalledWith("brulion:sidebar-collapsed")
  })

  it("defaults to false (expanded) when nothing is stored", async () => {
    get.mockResolvedValue(undefined)
    expect(await loadSidebarCollapsed()).toBe(false)
  })
})

describe("saveExpandedFolders / loadExpandedFolders (FEAT-0043)", () => {
  it("saves the set as an array under a stable key", async () => {
    await saveExpandedFolders(new Set(["a", "a/b"]))
    expect(set).toHaveBeenCalledWith("brulion:expanded-folders", ["a", "a/b"])
  })

  it("loads the stored paths back into a set", async () => {
    get.mockResolvedValue(["a", "a/b"])
    expect(await loadExpandedFolders()).toEqual(new Set(["a", "a/b"]))
    expect(get).toHaveBeenCalledWith("brulion:expanded-folders")
  })

  it("defaults to an empty set when nothing is stored (folders collapsed by default)", async () => {
    get.mockResolvedValue(undefined)
    expect(await loadExpandedFolders()).toEqual(new Set())
  })
})

describe("saveSidebarWidth / loadSidebarWidth (FEAT-0044)", () => {
  it("saves the width under a stable key", async () => {
    await saveSidebarWidth(320)
    expect(set).toHaveBeenCalledWith("brulion:sidebar-width", 320)
  })

  it("loads the stored width from the same key", async () => {
    get.mockResolvedValue(320)
    expect(await loadSidebarWidth()).toBe(320)
    expect(get).toHaveBeenCalledWith("brulion:sidebar-width")
  })

  it("returns null when nothing is stored (default basis applies)", async () => {
    get.mockResolvedValue(undefined)
    expect(await loadSidebarWidth()).toBeNull()
  })

  it("returns null for a corrupt non-number stored value", async () => {
    get.mockResolvedValue("oops" as unknown as number)
    expect(await loadSidebarWidth()).toBeNull()
  })
})

describe("saveRecency / loadRecency (FEAT-0039)", () => {
  it("saves the MRU list under a stable key", async () => {
    await saveRecency(["b.md", "a.md"])
    expect(set).toHaveBeenCalledWith("brulion:recency", ["b.md", "a.md"])
  })

  it("loads the stored list from the same key", async () => {
    get.mockResolvedValue(["b.md", "a.md"])
    expect(await loadRecency()).toEqual(["b.md", "a.md"])
    expect(get).toHaveBeenCalledWith("brulion:recency")
  })

  it("defaults to an empty list when nothing is stored", async () => {
    get.mockResolvedValue(undefined)
    expect(await loadRecency()).toEqual([])
  })
})

describe("hasPermission", () => {
  it("is true only when queryPermission is granted (readwrite, no prompt)", async () => {
    const granted = handleWith({ query: "granted" })
    expect(await hasPermission(granted)).toBe(true)
    expect(granted.queryPermission).toHaveBeenCalledWith({ mode: "readwrite" })

    expect(await hasPermission(handleWith({ query: "prompt" }))).toBe(false)
    expect(await hasPermission(handleWith({ query: "denied" }))).toBe(false)
  })
})

describe("requestAccess", () => {
  it("is true only when requestPermission is granted (readwrite)", async () => {
    const granted = handleWith({ request: "granted" })
    expect(await requestAccess(granted)).toBe(true)
    expect(granted.requestPermission).toHaveBeenCalledWith({ mode: "readwrite" })

    expect(await requestAccess(handleWith({ request: "denied" }))).toBe(false)
  })
})
