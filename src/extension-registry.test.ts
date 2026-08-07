import { beforeEach, describe, expect, it, vi } from "vitest"
import { ExtensionRegistry } from "./extension-registry"
import type { ScriptDiscovery, ScriptRecord } from "./script-storage"

const storage = vi.hoisted(() => ({
  listScripts: vi.fn(),
  readScript: vi.fn(),
}))
const runners = vi.hoisted(() => ({
  instances: [] as Array<{ id: string; dispose: ReturnType<typeof vi.fn>; getActions: ReturnType<typeof vi.fn> }>,
}))

vi.mock("./script-storage", () => storage)
vi.mock("./extension-runner", () => ({
  ExtensionRunner: class {
    readonly id: string
    readonly dispose = vi.fn()
    readonly getActions = vi.fn(() => [
      { id: `${this.id}:run`, label: this.id, run: vi.fn() },
    ])

    constructor(options: { manifest: { id: string } }) {
      this.id = options.manifest.id
      runners.instances.push(this)
    }

    async start(): Promise<void> {
      if (this.id === "broken") throw new Error("broken script")
    }
  },
}))

const discovery: ScriptDiscovery[] = [
  {
    id: "alpha",
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      id: "alpha",
      name: "Alpha",
      version: "1.0.0",
      entry: "main.js",
      permissions: [],
    },
    manifestLastModified: 1,
  },
  {
    id: "broken",
    manifest: {
      schemaVersion: 1,
      apiVersion: 1,
      id: "broken",
      name: "Broken",
      version: "1.0.0",
      entry: "main.js",
      permissions: [],
    },
    manifestLastModified: 2,
  },
  { id: "bad folder", manifest: null, manifestLastModified: null, error: "unsafe" },
]

describe("FEAT-0084 ExtensionRegistry", () => {
  beforeEach(() => {
    storage.listScripts.mockReset().mockResolvedValue(discovery)
    storage.readScript.mockReset().mockImplementation(async (_root: unknown, id: string) => {
      const item = discovery.find((entry) => entry.id === id)
      return { manifest: item?.manifest, source: "export default () => {}", sourceLastModified: 3, manifestLastModified: 1 } as ScriptRecord
    })
    runners.instances.length = 0
  })

  it("starts only explicitly enabled valid scripts and exposes their actions", async () => {
    const changed = vi.fn()
    const registry = new ExtensionRegistry({ onActionsChanged: changed })
    await registry.load({} as FileSystemDirectoryHandle, { editor: {} as never, notes: {} as never }, ["alpha"])

    expect(runners.instances.map((runner) => runner.id)).toEqual(["alpha"])
    expect(registry.getActions().map((action) => action.id)).toEqual(["alpha:run"])
    expect(changed).toHaveBeenCalled()
  })

  it("isolates a failed enabled script and disposes old runners on reload", async () => {
    const errors = vi.fn()
    const registry = new ExtensionRegistry({ onError: errors })
    await registry.load({} as FileSystemDirectoryHandle, { editor: {} as never, notes: {} as never }, ["alpha", "broken"])
    expect(registry.getActions().map((action) => action.id)).toEqual(["alpha:run"])
    expect(errors).toHaveBeenCalledWith(expect.any(Error), "broken")

    const old = runners.instances[0]
    await registry.load({} as FileSystemDirectoryHandle, { editor: {} as never, notes: {} as never }, [])
    expect(old.dispose).toHaveBeenCalledOnce()
    expect(registry.getActions()).toEqual([])
  })
})
