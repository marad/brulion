import { beforeEach, describe, expect, it, vi } from "vitest"

const storage = vi.hoisted(() => ({
  listScripts: vi.fn(),
  readScript: vi.fn(),
  writeScriptSource: vi.fn(),
  deleteScript: vi.fn(),
}))

vi.mock("./script-storage", () => storage)

import { mountExtensionManager } from "./extension-manager"
import type { ScriptRecord } from "./script-storage"

describe("FEAT-0082 extension workbench", () => {
  beforeEach(() => {
    document.body.replaceChildren()
    storage.listScripts.mockReset().mockResolvedValue([
      {
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
      },
    ])
    storage.readScript.mockReset().mockResolvedValue({
      manifest: {
        schemaVersion: 1,
        apiVersion: 1,
        id: "daily-tools",
        name: "Daily tools",
        version: "0.1.0",
        entry: "main.js",
        permissions: ["commands"],
      },
      source: "export default () => {}",
      sourceLastModified: 4,
      manifestLastModified: 1,
    })
    storage.writeScriptSource.mockResolvedValue({ status: "saved", lastModified: 5 })
    storage.deleteScript.mockResolvedValue(undefined)
  })

  it("lists scripts and exposes an explicit enable toggle", async () => {
    const enabled = vi.fn(() => false)
    const onEnabledChange = vi.fn()
    const backdrop = document.createElement("div")
    const handle = mountExtensionManager(backdrop, {
      getRoot: () => ({}) as FileSystemDirectoryHandle,
      isEnabled: enabled,
      onEnabledChange,
    })
    handle.open()
    await Promise.resolve()

    expect(backdrop.hidden).toBe(false)
    expect(backdrop.querySelector(".extensions-row-label strong")?.textContent).toBe("Daily tools")
    const toggle = backdrop.querySelector<HTMLButtonElement>(".extensions-toggle")
    expect(toggle?.textContent).toBe("Enable")
    toggle?.click()
    await Promise.resolve()
    expect(onEnabledChange).toHaveBeenCalledWith("daily-tools", true)
    handle.close()
  })

  it("opens the entry in CodeMirror and saves with the loaded mtime", async () => {
    const onScriptsChanged = vi.fn()
    const backdrop = document.createElement("div")
    const handle = mountExtensionManager(backdrop, {
      getRoot: () => ({}) as FileSystemDirectoryHandle,
      onScriptsChanged,
    })
    handle.open()
    await Promise.resolve()
    backdrop.querySelector<HTMLButtonElement>(".extensions-edit")?.click()
    await Promise.resolve()

    expect(backdrop.querySelector<HTMLElement>(".extensions-editor-panel")?.hidden).toBe(false)
    expect(backdrop.querySelector(".cm-content")?.textContent).toContain("export default")
    backdrop.querySelector<HTMLButtonElement>(".extensions-editor-actions button:not(.extensions-delete)")?.click()
    await Promise.resolve()
    expect(storage.writeScriptSource).toHaveBeenCalledWith(
      expect.anything(),
      "daily-tools",
      "export default () => {}",
      4,
    )
    expect(onScriptsChanged).toHaveBeenCalled()
    handle.close()
  })

  it("keeps the most recently selected script when reads finish out of order", async () => {
    let resolveFirst!: (value: ScriptRecord) => void
    let resolveSecond!: (value: ScriptRecord) => void
    const firstRead = new Promise<ScriptRecord>((resolve) => {
      resolveFirst = resolve
    })
    storage.listScripts.mockResolvedValue([
      {
        id: "first",
        manifest: {
          schemaVersion: 1,
          apiVersion: 1,
          id: "first",
          name: "First",
          version: "0.1.0",
          entry: "main.js",
          permissions: [],
        },
        manifestLastModified: 1,
      },
      {
        id: "second",
        manifest: {
          schemaVersion: 1,
          apiVersion: 1,
          id: "second",
          name: "Second",
          version: "0.1.0",
          entry: "main.js",
          permissions: [],
        },
        manifestLastModified: 2,
      },
    ])
    storage.readScript.mockImplementation((_: unknown, id: string) => {
      if (id === "first") return firstRead
      return new Promise<ScriptRecord>((resolve) => {
        resolveSecond = resolve
      })
    })
    const backdrop = document.createElement("div")
    const handle = mountExtensionManager(backdrop, {
      getRoot: () => ({}) as FileSystemDirectoryHandle,
    })
    handle.open()
    await Promise.resolve()
    const edits = backdrop.querySelectorAll<HTMLButtonElement>(".extensions-edit")
    edits[0]?.click()
    edits[1]?.click()
    resolveSecond({
      manifest: { schemaVersion: 1, apiVersion: 1, id: "second", name: "Second", version: "0.1.0", entry: "main.js", permissions: [] },
      source: "second source",
      sourceLastModified: 2,
      manifestLastModified: 2,
    })
    await Promise.resolve()
    resolveFirst({
      manifest: { schemaVersion: 1, apiVersion: 1, id: "first", name: "First", version: "0.1.0", entry: "main.js", permissions: [] },
      source: "first source",
      sourceLastModified: 1,
      manifestLastModified: 1,
    })
    await Promise.resolve()

    expect(backdrop.querySelector<HTMLElement>(".extensions-editor-title")?.textContent).toContain("Second")
    expect(backdrop.querySelector(".cm-content")?.textContent).toContain("second source")
    handle.close()
  })
})
