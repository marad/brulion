import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  listVaults,
  getVault,
  addVault,
  markVaultAttached,
  removeVault,
  migrateLegacyFolder,
  effectiveVaultName,
  resolveVaultRef,
  pickStartupVault,
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
  // Models idb-keyval's atomic read-modify-write: the get→apply→put runs to
  // completion synchronously (no internal await), exactly as a single IDB
  // readwrite transaction serializes, so two concurrent updates can't interleave.
  update: vi.fn(async (key: unknown, updater: (old: unknown) => unknown) => {
    store.set(key, updater(store.has(key) ? store.get(key) : undefined))
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

  describe("markVaultAttached", () => {
    it("moves the given vault to the front", async () => {
      const a = await addVault(fakeHandle("a"))
      const b = await addVault(fakeHandle("b"))
      // order is [b, a]; attaching a brings it to the front.
      await markVaultAttached(a.id, "")

      const list = await listVaults()
      expect(list.map((v) => v.id)).toEqual([a.id, b.id])
    })

    it("is a no-op when the id is absent", async () => {
      const a = await addVault(fakeHandle("a"))
      const b = await addVault(fakeHandle("b"))
      const before = (await listVaults()).map((v) => v.id)

      await markVaultAttached("missing", "notes")

      const after = (await listVaults()).map((v) => v.id)
      expect(after).toEqual(before)
      expect(after).toEqual([b.id, a.id])
    })

    it("AC-3: caches the configured (trimmed) workspace name on the vault", async () => {
      const v = await addVault(fakeHandle("my-notes"))
      await markVaultAttached(v.id, "  notes  ")
      expect((await getVault(v.id))?.workspace).toBe("notes")
    })

    it("AC-3: clears the field when the name is blank (back to the folder-name default)", async () => {
      const v = await addVault(fakeHandle("my-notes"))
      await markVaultAttached(v.id, "notes")
      await markVaultAttached(v.id, "   ")
      const stored = await getVault(v.id)
      expect(stored?.workspace).toBeUndefined()
      expect(effectiveVaultName(stored!)).toBe("my-notes")
    })

    it("does not touch other vaults' cached name", async () => {
      const a = await addVault(fakeHandle("a"))
      const b = await addVault(fakeHandle("b"))
      await markVaultAttached(a.id, "aaa")
      expect((await getVault(a.id))?.workspace).toBe("aaa")
      expect((await getVault(b.id))?.workspace).toBeUndefined()
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

  describe("concurrent writes (FEAT-0059 — no lost update across windows)", () => {
    it("keeps both vaults when two folders are added at once", async () => {
      // Two windows picking folders simultaneously: the old get-then-set pattern
      // let the second set clobber the first vault. The read-modify-write transaction
      // (idb-keyval update) serializes them, so both survive.
      const [a, b] = await Promise.all([
        addVault(fakeHandle("a")),
        addVault(fakeHandle("b")),
      ])
      const ids = (await listVaults()).map((v) => v.id).sort()
      expect(ids).toEqual([a.id, b.id].sort())
    })

    it("does not drop a vault when an add and an attach race", async () => {
      const a = await addVault(fakeHandle("a"))
      await Promise.all([addVault(fakeHandle("b")), markVaultAttached(a.id, "")])
      const ids = (await listVaults()).map((v) => v.id)
      expect(ids).toContain(a.id)
      expect(ids).toHaveLength(2)
    })
  })

  describe("effectiveVaultName (FEAT-0079)", () => {
    it("AC-1: falls back to the folder name when workspace is unset", () => {
      expect(effectiveVaultName({ name: "my-notes" })).toBe("my-notes")
    })

    it("AC-1: falls back to the folder name when workspace is empty or blank", () => {
      expect(effectiveVaultName({ name: "my-notes", workspace: "" })).toBe("my-notes")
      expect(effectiveVaultName({ name: "my-notes", workspace: "   " })).toBe("my-notes")
    })

    it("AC-2: uses the configured workspace (trimmed) over the folder name", () => {
      expect(effectiveVaultName({ name: "my-notes", workspace: "notes" })).toBe("notes")
      expect(effectiveVaultName({ name: "my-notes", workspace: "  notes  " })).toBe("notes")
    })
  })

  describe("resolveVaultRef (FEAT-0079)", () => {
    it("AC-4: resolves a vault by its effective (configured) name", async () => {
      const v = await addVault(fakeHandle("weird-local-folder-name"))
      await markVaultAttached(v.id, "notes")
      expect((await resolveVaultRef("notes"))?.id).toBe(v.id)
    })

    it("AC-4: resolves by the folder name when no workspace is configured", async () => {
      const v = await addVault(fakeHandle("notes"))
      expect((await resolveVaultRef("notes"))?.id).toBe(v.id)
    })

    it("AC-5: falls back to an opaque id when no name matches (legacy links)", async () => {
      const v = await addVault(fakeHandle("notes"))
      // `v.id` is an opaque id, not equal to any effective name, so the id branch wins.
      expect((await resolveVaultRef(v.id))?.id).toBe(v.id)
    })

    it("AC-6: a name collision resolves to the most-recently-used vault", async () => {
      const first = await addVault(fakeHandle("notes"))
      const second = await addVault(fakeHandle("notes"))
      // Both have effective name "notes"; the set is most-recent-first, so `second` wins.
      expect((await resolveVaultRef("notes"))?.id).toBe(second.id)
      // Re-attaching `first` makes it most-recent — now it wins the same ref.
      await markVaultAttached(first.id, "")
      expect((await resolveVaultRef("notes"))?.id).toBe(first.id)
    })

    it("AC-7: returns undefined when nothing matches by name or id", async () => {
      await addVault(fakeHandle("notes"))
      expect(await resolveVaultRef("ghost")).toBeUndefined()
    })

    it("prefers a name match over an id match", async () => {
      // A pathological set where one vault's id equals another vault's effective name.
      const named = await addVault(fakeHandle("shared-token"))
      const other = await addVault(fakeHandle("other"))
      // Force `named`'s effective name to be `other`'s id: the name branch must win.
      await markVaultAttached(named.id, other.id)
      expect((await resolveVaultRef(other.id))?.id).toBe(named.id)
    })
  })

  describe("pickStartupVault (FEAT-0079)", () => {
    it("AC-7: an explicit unmatched ?ws does NOT substitute another vault", async () => {
      // A most-recent vault exists, but the URL asks for a different, unknown name.
      await addVault(fakeHandle("journal"))
      // Pre-fix this returned the most-recent `journal` vault (wrong folder for the
      // permalink); it must now yield undefined so the caller shows the pick flow.
      expect(await pickStartupVault("notes")).toBeUndefined()
    })

    it("AC-4: an explicit matched ?ws returns its vault", async () => {
      await addVault(fakeHandle("journal"))
      const notes = await addVault(fakeHandle("notes"))
      expect((await pickStartupVault("notes"))?.id).toBe(notes.id)
    })

    it("AC-7: an absent ?ws falls back to the most-recently-used vault", async () => {
      const a = await addVault(fakeHandle("a"))
      const b = await addVault(fakeHandle("b"))
      // `b` is most-recent; the fallback picks it, not the older `a`.
      expect((await pickStartupVault(null))?.id).toBe(b.id)
      expect((await pickStartupVault(null))?.id).not.toBe(a.id)
      // an empty string counts as absent (a falsy `?ws`)
      expect((await pickStartupVault(""))?.id).toBe(b.id)
    })

    it("returns undefined for an absent ?ws when there are no vaults", async () => {
      expect(await pickStartupVault(null)).toBeUndefined()
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
