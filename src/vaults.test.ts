import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  listVaults,
  getVault,
  addVault,
  touchVault,
  removeVault,
  migrateLegacyFolder,
} from "./vaults"

/**
 * In-memory, Map-backed stand-in for idb-keyval. The vault store persists under a
 * single key; these tests assert on observable behavior (what `listVaults` reports,
 * returned values, and that the legacy key is deleted via the mocked `del`) rather
 * than on the storage layout.
 */
const store = new Map<unknown, unknown>()

vi.mock("idb-keyval", () => ({
  get: vi.fn(async (key: unknown) =>
    store.has(key) ? store.get(key) : undefined,
  ),
  set: vi.fn(async (key: unknown, value: unknown) => {
    store.set(key, value)
  }),
  del: vi.fn(async (key: unknown) => {
    store.delete(key)
  }),
}))

import * as idb from "idb-keyval"
const del = vi.mocked(idb.del)

const LEGACY_KEY = "brulion:dir"

/**
 * A fake directory handle. `isSameEntry` compares a shared `key`: two handles with
 * the same key are "the same folder" even when they are distinct objects — so dedup
 * is proven to go through `isSameEntry`, not object `===`. With no explicit key, the
 * key defaults to the handle itself, giving plain object-identity semantics.
 */
function fakeHandle(name: string, key?: unknown): FileSystemDirectoryHandle {
  const handle = {
    name,
    _key: undefined as unknown,
    async isSameEntry(other: { _key?: unknown }) {
      return other?._key === handle._key
    },
  }
  handle._key = key ?? handle
  return handle as unknown as FileSystemDirectoryHandle
}

beforeEach(() => {
  store.clear()
  vi.clearAllMocks()
})

describe("vault store", () => {
  describe("listVaults", () => {
    it("returns an empty array when nothing is stored", async () => {
      expect(await listVaults()).toEqual([])
    })
  })

  describe("addVault", () => {
    it("adds a handle and returns a vault with its name, the handle, and a non-empty id", async () => {
      const handle = fakeHandle("notes")
      const vault = await addVault(handle)

      expect(vault.name).toBe("notes")
      expect(vault.handle).toBe(handle)
      expect(typeof vault.id).toBe("string")
      expect(vault.id.length).toBeGreaterThan(0)

      const list = await listVaults()
      expect(list).toHaveLength(1)
      expect(list[0]).toEqual(vault)
    })

    it("generates distinct ids for different folders", async () => {
      const a = await addVault(fakeHandle("a"))
      const b = await addVault(fakeHandle("b"))

      expect(a.id).not.toBe(b.id)
      expect(await listVaults()).toHaveLength(2)
    })

    it("moves a freshly added vault to the front (most-recent-first)", async () => {
      const a = await addVault(fakeHandle("a"))
      const b = await addVault(fakeHandle("b"))

      const list = await listVaults()
      expect(list.map((v) => v.id)).toEqual([b.id, a.id])
    })

    it("reuses the id and does not grow the list when re-adding the same handle object", async () => {
      const handle = fakeHandle("notes")
      const first = await addVault(handle)
      const again = await addVault(handle)

      expect(again.id).toBe(first.id)
      expect(await listVaults()).toHaveLength(1)
    })

    it("dedups via isSameEntry, not object identity: a different handle for the same folder reuses the id", async () => {
      const sharedKey = Symbol("same-folder")
      const original = fakeHandle("notes", sharedKey)
      const reopened = fakeHandle("notes", sharedKey)

      // Different objects...
      expect(original).not.toBe(reopened)

      const first = await addVault(original)
      const second = await addVault(reopened)

      // ...but the same folder per isSameEntry, so the vault is reused, not duplicated.
      expect(second.id).toBe(first.id)
      expect(await listVaults()).toHaveLength(1)
    })

    it("moves an existing (deduped) vault back to the front", async () => {
      const a = await addVault(fakeHandle("a"))
      const b = await addVault(fakeHandle("b"))
      // a is now last; re-adding it should bring it to the front.
      const aAgain = await addVault(a.handle)

      expect(aAgain.id).toBe(a.id)
      const list = await listVaults()
      expect(list.map((v) => v.id)).toEqual([a.id, b.id])
      expect(list).toHaveLength(2)
    })
  })

  describe("getVault", () => {
    it("returns the matching vault (hit)", async () => {
      const vault = await addVault(fakeHandle("notes"))
      expect(await getVault(vault.id)).toEqual(vault)
    })

    it("returns undefined for an unknown id (miss)", async () => {
      await addVault(fakeHandle("notes"))
      expect(await getVault("does-not-exist")).toBeUndefined()
    })

    it("returns undefined when nothing is stored", async () => {
      expect(await getVault("anything")).toBeUndefined()
    })
  })

  describe("touchVault", () => {
    it("moves the given vault to the front", async () => {
      const a = await addVault(fakeHandle("a"))
      const b = await addVault(fakeHandle("b"))
      // order is [b, a]; touching a brings it to the front.
      await touchVault(a.id)

      const list = await listVaults()
      expect(list.map((v) => v.id)).toEqual([a.id, b.id])
    })

    it("is a no-op when the id is absent", async () => {
      const a = await addVault(fakeHandle("a"))
      const b = await addVault(fakeHandle("b"))
      const before = (await listVaults()).map((v) => v.id)

      await touchVault("missing")

      const after = (await listVaults()).map((v) => v.id)
      expect(after).toEqual(before)
      expect(after).toEqual([b.id, a.id])
    })
  })

  describe("removeVault", () => {
    it("removes the vault with the given id", async () => {
      const a = await addVault(fakeHandle("a"))
      const b = await addVault(fakeHandle("b"))

      await removeVault(a.id)

      const list = await listVaults()
      expect(list.map((v) => v.id)).toEqual([b.id])
      expect(await getVault(a.id)).toBeUndefined()
    })

    it("is a no-op when the id is absent", async () => {
      const a = await addVault(fakeHandle("a"))
      await removeVault("missing")
      expect((await listVaults()).map((v) => v.id)).toEqual([a.id])
    })
  })

  describe("migrateLegacyFolder", () => {
    it("migrates the legacy handle when the set is empty: adds it as the first vault, clears the legacy key, and returns it", async () => {
      const legacy = fakeHandle("legacy-folder")
      store.set(LEGACY_KEY, legacy)

      const migrated = await migrateLegacyFolder()

      expect(migrated).toBeDefined()
      expect(migrated?.name).toBe("legacy-folder")
      expect(migrated?.handle).toBe(legacy)

      const list = await listVaults()
      expect(list).toHaveLength(1)
      expect(list[0]).toEqual(migrated)

      // Legacy key cleared via the mocked del.
      expect(del).toHaveBeenCalledWith(LEGACY_KEY)
      expect(store.has(LEGACY_KEY)).toBe(false)
    })

    it("is a no-op returning undefined when the vault set is non-empty", async () => {
      const existing = await addVault(fakeHandle("existing"))
      store.set(LEGACY_KEY, fakeHandle("legacy-folder"))

      const migrated = await migrateLegacyFolder()

      expect(migrated).toBeUndefined()
      // The existing set is untouched; the legacy handle is not adopted.
      const list = await listVaults()
      expect(list.map((v) => v.id)).toEqual([existing.id])
    })

    it("returns undefined when there is no legacy handle", async () => {
      expect(await migrateLegacyFolder()).toBeUndefined()
      expect(await listVaults()).toEqual([])
    })

    it("is idempotent: a second call after a successful migration is a no-op", async () => {
      store.set(LEGACY_KEY, fakeHandle("legacy-folder"))
      const first = await migrateLegacyFolder()
      expect(first).toBeDefined()

      const second = await migrateLegacyFolder()
      expect(second).toBeUndefined()
      expect(await listVaults()).toHaveLength(1)
    })
  })
})
