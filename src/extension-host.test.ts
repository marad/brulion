import { describe, expect, it, vi } from "vitest"
import { ExtensionHost, type ExtensionEditorCapabilities, type ExtensionNoteCapabilities } from "./extension-host"
import { ExtensionRpcPeer, type RpcEndpoint, type RpcValue } from "./extension-rpc"
import type { ScriptPermission } from "./script-manifest"

type Listener = (event: { data: unknown }) => void

class FakePort implements RpcEndpoint {
  peer: FakePort | null = null
  private readonly listeners = new Set<Listener>()
  private closed = false

  postMessage(message: unknown): void {
    if (this.closed) throw new Error("port closed")
    const peer = this.peer
    if (!peer || peer.closed) return
    queueMicrotask(() => peer.dispatch(message))
  }

  addEventListener(type: "message", listener: Listener): void {
    if (type === "message") this.listeners.add(listener)
  }

  removeEventListener(type: "message", listener: Listener): void {
    if (type === "message") this.listeners.delete(listener)
  }

  start(): void {}

  close(): void {
    this.closed = true
  }

  private dispatch(data: unknown): void {
    if (this.closed) return
    for (const listener of this.listeners) listener({ data })
  }
}

function channel(): [FakePort, FakePort] {
  const left = new FakePort()
  const right = new FakePort()
  left.peer = right
  right.peer = left
  return [left, right]
}

async function setup(options: {
  editor?: Partial<ExtensionEditorCapabilities>
  notes?: Partial<ExtensionNoteCapabilities>
  maxCommands?: number
  permissions?: readonly ScriptPermission[]
} = {}): Promise<{
  host: ExtensionHost
  extension: ExtensionRpcPeer
  invoke: ReturnType<typeof vi.fn>
}> {
  const [hostPort, extensionPort] = channel()
  const hostPeer = new ExtensionRpcPeer(hostPort, { nonce: "nonce-1", timeoutMs: 50 })
  const extension = new ExtensionRpcPeer(extensionPort, { nonce: "nonce-1", timeoutMs: 50 })
  const editor: ExtensionEditorCapabilities = {
    getText: vi.fn(async () => "editor text"),
    getSelection: vi.fn(async () => ({ from: 2, to: 5, text: "dit" })),
    replaceSelection: vi.fn(async () => undefined),
    focus: vi.fn(async () => undefined),
    ...options.editor,
  }
  const notes: ExtensionNoteCapabilities = {
    list: vi.fn(async () => ["a.md", "folder/b.md"]),
    read: vi.fn(async () => ({ content: "body", lastModified: 12 })),
    create: vi.fn(async () => ({ status: "created" as const })),
    write: vi.fn(async () => ({ status: "saved" as const, lastModified: 13 })),
    delete: vi.fn(async () => undefined),
    move: vi.fn(async () => ({ status: "moved" as const })),
    ...options.notes,
  }
  const invoke = vi.fn((_params: RpcValue) => null)
  extension.register("commands.invoke", invoke)
  const host = new ExtensionHost({
    scriptId: "daily-tools",
    peer: hostPeer,
    editor,
    notes,
    maxCommands: options.maxCommands,
    permissions: options.permissions,
  })
  host.start()
  extension.start()
  await Promise.all([host.ready(), extension.ready()])
  return { host, extension, invoke }
}

describe("FEAT-0083 ExtensionHost", () => {
  it("publishes a namespaced action and invokes the extension command", async () => {
    const { host, extension, invoke } = await setup()

    await expect(
      extension.call("commands.register", {
        id: "insert-date",
        label: "Insert date",
        description: "Insert today's date",
      }),
    ).resolves.toEqual({ actionId: "daily-tools:insert-date" })
    expect(host.getActions().map((action) => action.id)).toEqual(["daily-tools:insert-date"])

    host.getActions()[0].run()
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    expect(invoke).toHaveBeenCalledWith({ id: "insert-date" })

    host.dispose()
  })

  it("rejects malformed, duplicate, and over-limit commands without corrupting actions", async () => {
    const { host, extension } = await setup({ maxCommands: 1 })
    const valid = { id: "one", label: "One" }
    await expect(extension.call("commands.register", valid)).resolves.toEqual({
      actionId: "daily-tools:one",
    })
    await expect(extension.call("commands.register", valid)).rejects.toMatchObject({
      code: "handler_error",
    })
    await expect(
      extension.call("commands.register", { id: "bad:id", label: "Bad" }),
    ).rejects.toMatchObject({ code: "handler_error" })
    await expect(
      extension.call("commands.register", { id: "two", label: "Two" }),
    ).rejects.toMatchObject({ code: "handler_error" })
    expect(host.getActions().map((action) => action.id)).toEqual(["daily-tools:one"])

    await expect(extension.call("commands.unregister", { id: "one" })).resolves.toEqual(null)
    expect(host.getActions()).toEqual([])
    host.dispose()
  })

  it("exposes only narrow editor values and forwards replacement/focus", async () => {
    const getText = vi.fn(async () => "current")
    const getSelection = vi.fn(async () => ({ from: 1, to: 4, text: "urr" }))
    const replaceSelection = vi.fn(async (_text: string) => undefined)
    const focus = vi.fn(async () => undefined)
    const { host, extension } = await setup({
      editor: { getText, getSelection, replaceSelection, focus },
    })

    await expect(extension.call("editor.getText", null)).resolves.toBe("current")
    await expect(extension.call("editor.getSelection", null)).resolves.toEqual({
      from: 1,
      to: 4,
      text: "urr",
    })
    await expect(
      extension.call("editor.replaceSelection", { text: "updated" }),
    ).resolves.toBe(null)
    await expect(extension.call("editor.focus", null)).resolves.toBe(null)
    expect(replaceSelection).toHaveBeenCalledWith("updated")
    expect(focus).toHaveBeenCalledOnce()
    host.dispose()
  })

  it("normalizes note paths and preserves write mtimes while rejecting traversal", async () => {
    const read = vi.fn(async (path: string) => ({ content: path, lastModified: 20 }))
    const write = vi.fn(async (path: string, content: string, expected: number | null) => ({
      ...(path === "notes/todo.md" && content === "next" && expected === 20
        ? { status: "saved" as const, lastModified: 21 }
        : { status: "conflict" as const }),
    }))
    const { host, extension } = await setup({ notes: { read, write } })

    await expect(extension.call("notes.read", { path: " notes/todo " })).resolves.toEqual({
      content: "notes/todo.md",
      lastModified: 20,
    })
    await expect(
      extension.call("notes.write", { path: "notes/todo", content: "next", expectedLastModified: 20 }),
    ).resolves.toEqual({ status: "saved", lastModified: 21 })
    expect(write).toHaveBeenCalledWith("notes/todo.md", "next", 20)

    await expect(
      extension.call("notes.write", { path: "../secret", content: "nope", expectedLastModified: null }),
    ).rejects.toMatchObject({ code: "handler_error" })
    await expect(
      extension.call("notes.write", { path: ".brulion/internal", content: "nope", expectedLastModified: null }),
    ).rejects.toMatchObject({ code: "handler_error" })
    expect(write).toHaveBeenCalledTimes(1)
    host.dispose()
  })

  it("disposes only its own actions and fails closed after disposal", async () => {
    const first = await setup()
    const second = await setup()
    await first.extension.call("commands.register", { id: "one", label: "One" })
    await second.extension.call("commands.register", { id: "two", label: "Two" })
    first.host.dispose()

    expect(first.host.getActions()).toEqual([])
    expect(second.host.getActions().map((action) => action.id)).toEqual(["daily-tools:two"])
    await expect(first.extension.call("editor.getText", null)).rejects.toMatchObject({
      code: "timeout",
    })
    second.host.dispose()
  })

  it("fails closed when a manifest omits a capability permission", async () => {
    const { host, extension } = await setup({ permissions: ["commands"] })

    await expect(extension.call("editor.getText", null)).rejects.toMatchObject({
      code: "handler_error",
    })
    await expect(extension.call("notes.list", null)).rejects.toMatchObject({
      code: "handler_error",
    })
    await expect(
      extension.call("commands.register", { id: "allowed", label: "Allowed" }),
    ).resolves.toEqual({ actionId: "daily-tools:allowed" })
    host.dispose()
  })
})
