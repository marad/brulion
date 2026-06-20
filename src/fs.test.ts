import { describe, it, expect, vi, afterEach } from "vitest"
import { pickFolder } from "./fs"

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
