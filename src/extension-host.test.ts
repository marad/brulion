import { describe, expect, it, vi } from "vitest"
import { HeartPulse, Puzzle, Sparkles } from "lucide"
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
  interaction?: Partial<import("./extension-host").ExtensionInteractionCapabilities>
  maxCommands?: number
  permissions?: readonly ScriptPermission[]
  dialogTimeoutMs?: number
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
    getSelection: vi.fn(async () => ({ anchor: 2, head: 5, text: "dit" })),
    setSelection: vi.fn(async () => undefined),
    replaceSelection: vi.fn(async () => undefined),
    focus: vi.fn(async () => undefined),
    ...options.editor,
  }
  const interaction = {
    setSelection: vi.fn(async () => undefined),
    showNotification: vi.fn(async () => undefined),
    alert: vi.fn(async () => undefined),
    confirm: vi.fn(async () => true),
    prompt: vi.fn(async () => "answer"),
    ...options.interaction,
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
    interaction,
    dialogTimeoutMs: options.dialogTimeoutMs,
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
        icon: "sparkles",
      }),
    ).resolves.toEqual({ actionId: "daily-tools:insert-date" })
    expect(host.getActions().map((action) => action.id)).toEqual(["daily-tools:insert-date"])
    expect(host.getActions()[0].icon).toBe(Sparkles)

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
    const getSelection = vi.fn(async () => ({ anchor: 4, head: 1, text: "urr" }))
    const replaceSelection = vi.fn(async (_text: string) => undefined)
    const focus = vi.fn(async () => undefined)
    const { host, extension } = await setup({
      editor: { getText, getSelection, replaceSelection, focus },
    })

    await expect(extension.call("editor.getText", null)).resolves.toBe("current")
    await expect(extension.call("editor.getSelection", null)).resolves.toEqual({
      anchor: 4,
      head: 1,
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

  it("supports direction-aware selection control without content replacement", async () => {
    const setSelection = vi.fn(async () => undefined)
    const getText = vi.fn(async () => "current")
    const { host, extension } = await setup({ editor: { getText, setSelection }, permissions: ["editor:selection"] })
    await expect(extension.call("editor.setSelection", { anchor: 7, head: 2 })).resolves.toBe(null)
    expect(setSelection).toHaveBeenCalledWith({ anchor: 7, head: 2 })
    await expect(extension.call("editor.setSelection", { anchor: 8, head: 2 })).rejects.toMatchObject({ code: "handler_error" })
    expect(setSelection).toHaveBeenCalledOnce()
    await expect(extension.call("editor.setSelection", { anchor: -1, head: 2 })).rejects.toMatchObject({ code: "handler_error" })
    await expect(extension.call("editor.setSelection", { anchor: 1, head: 2, extra: true })).rejects.toMatchObject({ code: "handler_error" })
    host.dispose()
  })

  it("validates formatted interaction values and permission boundaries", async () => {
    const interaction = { showNotification: vi.fn(async () => undefined), alert: vi.fn(async () => undefined), confirm: vi.fn(async () => true), prompt: vi.fn(async () => null), setSelection: vi.fn(async () => undefined) }
    const { host, extension } = await setup({ interaction, permissions: ["notifications", "dialogs"] })
    await expect(extension.call("notifications.show", { message: [{ type: "strong", text: "ok\\nnow" }], options: { level: "success" } })).resolves.toBe(null)
    await expect(extension.call("notifications.show", { message: [], options: {} })).rejects.toMatchObject({ code: "handler_error" })
    await expect(extension.call("notifications.show", { message: "x", options: { level: "info", extra: true } })).rejects.toMatchObject({ code: "handler_error" })
    await expect(extension.call("notifications.show", { message: "x", extra: true })).rejects.toMatchObject({ code: "handler_error" })
    await expect(extension.call("dialogs.prompt", { message: "name", options: { confirmLabel: "OK", cancelLabel: "Cancel" } })).resolves.toBe(null)
    await expect(extension.call("dialogs.prompt", { message: "name", options: { okLabel: "OK", cancelLabel: "Cancel" } })).rejects.toMatchObject({ code: "handler_error" })
    await expect(extension.call("dialogs.alert", { message: "x", options: { okLabel: "<b>" } })).rejects.toMatchObject({ code: "handler_error" })
    await expect(extension.call("dialogs.alert", { message: "x", options: { okLabel: "OK\n" } })).rejects.toMatchObject({ code: "handler_error" })
    await expect(extension.call("dialogs.confirm", { message: "x", options: { confirmLabel: "Yes", cancelLabel: "No" } })).resolves.toBe(true)
    await expect(extension.call("editor.setSelection", { anchor: 1, head: 1 })).rejects.toMatchObject({ code: "handler_error" })
    expect(interaction.setSelection).not.toHaveBeenCalled()
    host.dispose()
  })

  it("rejects invalid interactive results before they cross the RPC boundary", async () => {
    const confirm = vi.fn(async () => "yes" as unknown as boolean)
    const prompt = vi.fn(async () => 42 as unknown as string | null)
    const { host, extension } = await setup({ interaction: { confirm, prompt }, permissions: ["dialogs"] })
    await expect(extension.call("dialogs.confirm", { message: "x", options: { confirmLabel: "Yes", cancelLabel: "No" } })).rejects.toMatchObject({ code: "handler_error" })
    await expect(extension.call("dialogs.prompt", { message: "x", options: { confirmLabel: "OK", cancelLabel: "Cancel" } })).rejects.toMatchObject({ code: "handler_error" })
    host.dispose()
  })

  it("preserves coded dialog timeout and disposal errors across response envelopes", async () => {
    const timeout = new Error("dialog timed out") as Error & { code: string }
    timeout.code = "timeout"
    const disposed = new Error("dialog disposed") as Error & { code: string }
    disposed.code = "disposed"
    const alert = vi.fn()
      .mockRejectedValueOnce(timeout)
      .mockRejectedValueOnce(disposed)
    const { host, extension } = await setup({ interaction: { alert }, permissions: ["dialogs"] })

    await expect(extension.call("dialogs.alert", { message: "wait", options: { okLabel: "OK" } }))
      .rejects.toMatchObject({ code: "timeout", message: "dialog timed out" })
    await expect(extension.call("dialogs.alert", { message: "wait", options: { okLabel: "OK" } }))
      .rejects.toMatchObject({ code: "disposed", message: "dialog disposed" })

    host.dispose()
  })

  it("times out a dialog, disposes its source, and allows a later dialog", async () => {
    let release: (() => void) | undefined
    const alert = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve }))
      .mockResolvedValueOnce(undefined)
    const dispose = vi.fn()
    const { host, extension } = await setup({
      interaction: { alert, dispose }, permissions: ["dialogs"], dialogTimeoutMs: 5,
    })

    await expect(extension.call("dialogs.alert", { message: "stuck", options: { okLabel: "OK" } }))
      .rejects.toMatchObject({ code: "timeout" })
    expect(dispose).toHaveBeenCalledWith("daily-tools")
    release?.()
    await expect(extension.call("dialogs.alert", { message: "next", options: { okLabel: "OK" } }))
      .resolves.toBe(null)
    expect(alert).toHaveBeenCalledTimes(2)
    host.dispose()
  })

  it("disposes host interaction state before closing its peer", async () => {
    const dispose = vi.fn()
    const { host } = await setup({ interaction: { dispose } })
    host.dispose()
    expect(dispose).toHaveBeenCalledOnce()
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

    await expect(extension.call("notes.read", { path: "../secret" })).rejects.toMatchObject({
      code: "handler_error",
    })
    await expect(
      extension.call("notes.write", { path: "../secret", content: "nope", expectedLastModified: null }),
    ).rejects.toMatchObject({ code: "handler_error" })
    await expect(
      extension.call("notes.write", { path: ".brulion/internal", content: "nope", expectedLastModified: null }),
    ).rejects.toMatchObject({ code: "handler_error" })
    expect(write).toHaveBeenCalledTimes(1)
    host.dispose()
  })

  it("omits invalid legacy paths from note listings and deduplicates valid paths", async () => {
    const list = vi.fn(async () => [
      "ok.md",
      ".md",
      "bad?.md",
      "dir with newline\n/x.md",
      "ok.md",
    ])
    const { host, extension } = await setup({ notes: { list } })

    await expect(extension.call("notes.list", null)).resolves.toEqual(["ok.md"])
    expect(list).toHaveBeenCalledOnce()
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
      code: "disposed",
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

  it("accepts arbitrary icon metadata and keeps invocation isolated", async () => {
    const { host, extension, invoke } = await setup()
    await expect(
      extension.call("commands.register", {
        id: "pulse",
        label: "Pulse",
        icon: "heart-pulse",
      }),
    ).resolves.toEqual({ actionId: "daily-tools:pulse" })
    await expect(
      extension.call("commands.register", {
        id: "custom",
        label: "Custom",
        icon: "extension-owned-icon",
      }),
    ).resolves.toEqual({ actionId: "daily-tools:custom" })

    expect(host.getActions()[0].icon).toBe(HeartPulse)
    expect(host.getActions()[1].icon).toBe(Puzzle)
    host.getActions()[0].run()
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    expect(invoke).toHaveBeenCalledWith({ id: "pulse" })
    host.dispose()
  })

  it("defaults an omitted icon to puzzle without affecting registration", async () => {
    const { host, extension } = await setup()
    await expect(extension.call("commands.register", { id: "default-icon", label: "Default" })).resolves.toEqual({
      actionId: "daily-tools:default-icon",
    })
    expect(host.getActions()[0].icon).toBe(Puzzle)
    host.dispose()
  })
})
