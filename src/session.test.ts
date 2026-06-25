import { describe, it, expect, vi, beforeEach } from "vitest"
import * as idb from "idb-keyval"
import {
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
  migrateLegacySession,
} from "./session"

vi.mock("idb-keyval", () => ({
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
}))

const get = vi.mocked(idb.get)
const set = vi.mocked(idb.set)
const del = vi.mocked(idb.del)

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

describe("saveExpandedFolders / loadExpandedFolders (FEAT-0043, per-vault FEAT-0059)", () => {
  it("saves the set as an array under the vault-scoped key", async () => {
    await saveExpandedFolders("vault1", new Set(["a", "a/b"]))
    expect(set).toHaveBeenCalledWith("brulion:expanded-folders:vault1", ["a", "a/b"])
  })

  it("loads the stored paths back into a set from the vault-scoped key", async () => {
    get.mockResolvedValue(["a", "a/b"])
    expect(await loadExpandedFolders("vault1")).toEqual(new Set(["a", "a/b"]))
    expect(get).toHaveBeenCalledWith("brulion:expanded-folders:vault1")
  })

  it("defaults to an empty set when nothing is stored (folders collapsed by default)", async () => {
    get.mockResolvedValue(undefined)
    expect(await loadExpandedFolders("vault1")).toEqual(new Set())
  })

  it("keys distinct vaults separately", async () => {
    await saveExpandedFolders("vaultA", new Set(["x"]))
    await saveExpandedFolders("vaultB", new Set(["y"]))
    expect(set).toHaveBeenCalledWith("brulion:expanded-folders:vaultA", ["x"])
    expect(set).toHaveBeenCalledWith("brulion:expanded-folders:vaultB", ["y"])
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

describe("saveRecency / loadRecency (FEAT-0039, per-vault FEAT-0059)", () => {
  it("saves the MRU list under the vault-scoped key", async () => {
    await saveRecency("vault1", ["b.md", "a.md"])
    expect(set).toHaveBeenCalledWith("brulion:recency:vault1", ["b.md", "a.md"])
  })

  it("loads the stored list from the vault-scoped key", async () => {
    get.mockResolvedValue(["b.md", "a.md"])
    expect(await loadRecency("vault1")).toEqual(["b.md", "a.md"])
    expect(get).toHaveBeenCalledWith("brulion:recency:vault1")
  })

  it("defaults to an empty list when nothing is stored", async () => {
    get.mockResolvedValue(undefined)
    expect(await loadRecency("vault1")).toEqual([])
  })

  it("keys distinct vaults separately", async () => {
    await saveRecency("vaultA", ["x.md"])
    await saveRecency("vaultB", ["y.md"])
    expect(set).toHaveBeenCalledWith("brulion:recency:vaultA", ["x.md"])
    expect(set).toHaveBeenCalledWith("brulion:recency:vaultB", ["y.md"])
  })
})

describe("migrateLegacySession (FEAT-0059)", () => {
  it("copies legacy global recency/expanded onto the vault key, then clears the legacy keys", async () => {
    // Legacy globals present; per-vault values absent.
    get.mockImplementation(async (key: IDBValidKey) => {
      if (key === "brulion:recency") return ["b.md", "a.md"]
      if (key === "brulion:expanded-folders") return ["a", "a/b"]
      return undefined // per-vault keys not yet set
    })
    await migrateLegacySession("vault1")
    expect(set).toHaveBeenCalledWith("brulion:recency:vault1", ["b.md", "a.md"])
    expect(set).toHaveBeenCalledWith("brulion:expanded-folders:vault1", ["a", "a/b"])
    expect(del).toHaveBeenCalledWith("brulion:recency")
    expect(del).toHaveBeenCalledWith("brulion:expanded-folders")
  })

  it("does not clobber an existing per-vault value", async () => {
    get.mockImplementation(async (key: IDBValidKey) => {
      if (key === "brulion:recency") return ["legacy.md"]
      if (key === "brulion:recency:vault1") return ["existing.md"] // already set
      return undefined
    })
    await migrateLegacySession("vault1")
    expect(set).not.toHaveBeenCalledWith("brulion:recency:vault1", ["legacy.md"])
    expect(del).toHaveBeenCalledWith("brulion:recency") // legacy still cleared
  })

  it("is a no-op (only clears) when there are no legacy values", async () => {
    get.mockResolvedValue(undefined)
    await migrateLegacySession("vault1")
    expect(set).not.toHaveBeenCalled()
    expect(del).toHaveBeenCalledWith("brulion:recency")
    expect(del).toHaveBeenCalledWith("brulion:expanded-folders")
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
