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
