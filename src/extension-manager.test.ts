import { beforeEach, describe, expect, it, vi } from "vitest"

const storage = vi.hoisted(() => ({
  listScripts: vi.fn(),
  deleteScript: vi.fn(),
}))

vi.mock("./script-storage", () => storage)

import { mountExtensionManager } from "./extension-manager"

const validScript = {
  id: "daily-tools",
  manifest: {
    schemaVersion: 1,
    apiVersion: 1,
    id: "daily-tools",
    name: "Daily tools",
    version: "0.1.0",
    entry: "main.js",
    permissions: ["commands"],
  },
  manifestLastModified: 1,
}

describe("extension manager", () => {
  beforeEach(() => {
    document.body.replaceChildren()
    storage.listScripts.mockReset().mockResolvedValue([validScript])
    storage.deleteScript.mockReset().mockResolvedValue(undefined)
  })

  it("shows lifecycle controls without mounting an editor", async () => {
    const enabled = vi.fn(() => false)
    const onEnabledChange = vi.fn()
    const backdrop = document.createElement("div")
    const handle = mountExtensionManager(backdrop, {
      getRoot: () => ({}) as FileSystemDirectoryHandle,
      isEnabled: enabled,
      onEnabledChange,
    })

    handle.open()
    await vi.waitFor(() => expect(backdrop.querySelector(".extensions-row-label strong")?.textContent).toBe("Daily tools"))

    expect(backdrop.querySelector(".extensions-editor-panel")).toBeNull()
    expect(backdrop.querySelector(".extensions-edit")).toBeNull()
    expect(backdrop.querySelector<HTMLButtonElement>(".extensions-toggle")?.textContent).toBe("Enable")
    expect(backdrop.querySelector<HTMLButtonElement>(".extensions-remove")?.textContent).toBe("Remove")

    backdrop.querySelector<HTMLButtonElement>(".extensions-toggle")?.click()
    await vi.waitFor(() => expect(onEnabledChange).toHaveBeenCalledWith("daily-tools", true))
    handle.close()
  })

  it("removes an extension from the manager and clears its enablement", async () => {
    const onEnabledChange = vi.fn()
    const onScriptsChanged = vi.fn()
    const confirmDelete = vi.fn(() => true)
    const backdrop = document.createElement("div")
    const root = {} as FileSystemDirectoryHandle
    const handle = mountExtensionManager(backdrop, {
      getRoot: () => root,
      onEnabledChange,
      onScriptsChanged,
      confirmDelete,
    })

    handle.open()
    await vi.waitFor(() => expect(backdrop.querySelector(".extensions-remove")).not.toBeNull())
    backdrop.querySelector<HTMLButtonElement>(".extensions-remove")?.click()

    await vi.waitFor(() => expect(storage.deleteScript).toHaveBeenCalledWith(root, "daily-tools"))
    expect(confirmDelete).toHaveBeenCalledWith("daily-tools")
    expect(onEnabledChange).toHaveBeenCalledWith("daily-tools", false)
    expect(onScriptsChanged).toHaveBeenCalled()
    handle.close()
  })

  it("keeps invalid extensions removable but does not offer enablement", async () => {
    storage.listScripts.mockResolvedValue([
      { id: "broken", manifest: null, manifestLastModified: null, error: "Manifest is invalid." },
    ])
    const backdrop = document.createElement("div")
    const handle = mountExtensionManager(backdrop, {
      getRoot: () => ({}) as FileSystemDirectoryHandle,
    })

    handle.open()
    await vi.waitFor(() => expect(backdrop.querySelector(".extensions-remove")).not.toBeNull())

    expect(backdrop.querySelector(".extensions-toggle")).toBeNull()
    expect(backdrop.querySelector(".extensions-remove")).not.toBeNull()
    handle.close()
  })
})
