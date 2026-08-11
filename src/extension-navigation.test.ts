import { describe, expect, it, vi } from "vitest"
import {
  ExtensionHost,
  type ExtensionEditorCapabilities,
  type ExtensionNoteCapabilities,
} from "./extension-host"
import { ExtensionRpcPeer, type RpcEndpoint, type RpcValue } from "./extension-rpc"
import type {
  ExtensionNavigationCapabilities,
  LinkResolution,
  OpenNoteResult,
} from "./extension-navigation"
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

const oldPermissions: ScriptPermission[] = [
  "commands",
  "editor:read",
  "editor:write",
  "notes:read",
  "notes:write",
]

type HostOptionsWithNavigation = ConstructorParameters<typeof ExtensionHost>[0] & {
  navigation: ExtensionNavigationCapabilities
}

async function setup(options: {
  permissions?: readonly ScriptPermission[]
  navigation?: Partial<ExtensionNavigationCapabilities>
} = {}): Promise<{
  host: ExtensionHost
  extension: ExtensionRpcPeer
  navigation: ExtensionNavigationCapabilities
}> {
  const [hostPort, extensionPort] = channel()
  const hostPeer = new ExtensionRpcPeer(hostPort, { nonce: "nonce-navigation", timeoutMs: 50 })
  const extension = new ExtensionRpcPeer(extensionPort, { nonce: "nonce-navigation", timeoutMs: 50 })
  const editor: ExtensionEditorCapabilities = {
    getText: vi.fn(async () => ""),
    getSelection: vi.fn(async () => ({ from: 0, to: 0, text: "" })),
    replaceSelection: vi.fn(async () => undefined),
    focus: vi.fn(async () => undefined),
  }
  const notes: ExtensionNoteCapabilities = {
    list: vi.fn(async () => []),
    read: vi.fn(async () => ({ content: "", lastModified: null })),
    create: vi.fn(async () => ({ status: "created" as const })),
    write: vi.fn(async () => ({ status: "saved" as const, lastModified: 1 })),
    delete: vi.fn(async () => undefined),
    move: vi.fn(async () => ({ status: "moved" as const })),
  }
  const navigation: ExtensionNavigationCapabilities = {
    getActiveNote: vi.fn(async () => ({ path: "Journal/today.md" })),
    openNote: vi.fn(async (path, options) => ({
      status: "opened" as const,
      path,
      anchor: options?.anchor ?? null,
      anchorStatus: options?.anchor ? ("found" as const) : ("not-requested" as const),
    })),
    resolveLink: vi.fn(async () => ({
      status: "resolved" as const,
      path: "Journal/tomorrow.md",
      anchor: null,
    })),
    ...options.navigation,
  }
  const host = new ExtensionHost({
    scriptId: "navigation-test",
    peer: hostPeer,
    editor,
    notes,
    permissions: options.permissions,
    navigation,
  } as HostOptionsWithNavigation)
  host.start()
  extension.start()
  await Promise.all([host.ready(), extension.ready()])
  return { host, extension, navigation }
}

describe("FEAT-0091 extension navigation host boundary", () => {
  it("keeps navigation additive and denies every navigation method without its permission", async () => {
    const read = await setup({ permissions: oldPermissions })
    await expect(read.extension.call("navigation.getActiveNote", null)).rejects.toMatchObject({
      code: "handler_error",
    })
    await expect(
      read.extension.call("navigation.resolveLink", {
        target: "tomorrow",
        options: { kind: "wikilink" },
      }),
    ).rejects.toMatchObject({ code: "handler_error" })
    await expect(
      read.extension.call("navigation.openNote", { path: "Journal/tomorrow" }),
    ).rejects.toMatchObject({ code: "handler_error" })
    expect(read.navigation.getActiveNote).not.toHaveBeenCalled()
    expect(read.navigation.openNote).not.toHaveBeenCalled()
    expect(read.navigation.resolveLink).not.toHaveBeenCalled()
    read.host.dispose()

    const readOnly = await setup({ permissions: [...oldPermissions, "navigation:read"] })
    await expect(readOnly.extension.call("navigation.getActiveNote", null)).resolves.toEqual({
      path: "Journal/today.md",
    })
    await expect(
      readOnly.extension.call("navigation.resolveLink", {
        target: "tomorrow",
        options: { kind: "wikilink" },
      }),
    ).resolves.toMatchObject({ status: "resolved" })
    await expect(
      readOnly.extension.call("navigation.openNote", { path: "Journal/tomorrow" }),
    ).rejects.toMatchObject({ code: "handler_error" })
    expect(readOnly.navigation.openNote).not.toHaveBeenCalled()
    readOnly.host.dispose()

    const writeOnly = await setup({ permissions: [...oldPermissions, "navigation:write"] })
    await expect(
      writeOnly.extension.call("navigation.openNote", { path: "Journal/tomorrow" }),
    ).resolves.toMatchObject({ status: "opened", path: "Journal/tomorrow.md" })
    await expect(writeOnly.extension.call("navigation.getActiveNote", null)).rejects.toMatchObject({
      code: "handler_error",
    })
    await expect(
      writeOnly.extension.call("navigation.resolveLink", {
        target: "tomorrow",
        options: { kind: "wikilink" },
      }),
    ).rejects.toMatchObject({ code: "handler_error" })
    writeOnly.host.dispose()
  })

  it("forwards narrow host callbacks and their JSON-like discriminated results", async () => {
    const getActiveNote = vi.fn(async () => null)
    const openNote = vi.fn(async () => ({
      status: "already-open" as const,
      path: "Journal/today.md",
      anchor: "tasks",
      anchorStatus: "found" as const,
    }))
    const resolveLink = vi.fn(async () => ({
      status: "external" as const,
      target: "https://example.test",
    }))
    const { host, extension } = await setup({
      permissions: [...oldPermissions, "navigation:read", "navigation:write"],
      navigation: { getActiveNote, openNote, resolveLink },
    })

    await expect(extension.call("navigation.getActiveNote", null)).resolves.toBeNull()
    await expect(
      extension.call("navigation.openNote", {
        path: " Journal/today ",
        options: { anchor: "tasks" },
      }),
    ).resolves.toEqual({
      status: "already-open",
      path: "Journal/today.md",
      anchor: "tasks",
      anchorStatus: "found",
    } satisfies OpenNoteResult)
    await expect(
      extension.call("navigation.resolveLink", {
        target: "https://example.test",
        options: { kind: "markdown", from: "Journal/today" },
      }),
    ).resolves.toEqual({ status: "external", target: "https://example.test" } satisfies LinkResolution)

    expect(getActiveNote).toHaveBeenCalledOnce()
    expect(openNote).toHaveBeenCalledWith("Journal/today.md", { anchor: "tasks" })
    expect(resolveLink).toHaveBeenCalledWith(
      "https://example.test",
      { kind: "markdown", from: "Journal/today.md" },
    )
    host.dispose()
  })

  it("rejects unsafe paths and malformed navigation arguments before callbacks", async () => {
    const openNote = vi.fn(async () => ({
      status: "opened" as const,
      path: "safe.md",
      anchor: null,
      anchorStatus: "not-requested" as const,
    }))
    const resolveLink = vi.fn(async () => ({
      status: "invalid" as const,
      target: "bad",
    }))
    const { host, extension } = await setup({
      permissions: [...oldPermissions, "navigation:read", "navigation:write"],
      navigation: { openNote, resolveLink },
    })

    for (const path of ["../secret", ".brulion/state", "folder\\note", "folder/<note>", "/absolute"]) {
      await expect(extension.call("navigation.openNote", { path })).rejects.toMatchObject({
        code: "handler_error",
      })
    }
    for (const params of [
      { path: "safe", options: { anchor: 42 } },
      { path: "safe", options: { anchor: "#heading" } },
      { path: "safe", options: "bad" },
    ]) {
      await expect(extension.call("navigation.openNote", params)).rejects.toMatchObject({
        code: "handler_error",
      })
    }
    for (const params of [
      { target: "target", options: { kind: "unknown" } },
      { target: "target", options: { kind: "markdown", from: "../secret" } },
      { target: "target", options: { kind: "markdown", from: ".brulion/state" } },
      { target: "target", options: { kind: "markdown", from: "folder\\note" } },
      { target: "target", options: { kind: "markdown", from: 12 } },
      { target: "target", options: null },
    ] as RpcValue[]) {
      await expect(extension.call("navigation.resolveLink", params)).rejects.toMatchObject({
        code: "handler_error",
      })
    }

    expect(openNote).not.toHaveBeenCalled()
    expect(resolveLink).not.toHaveBeenCalled()
    host.dispose()
  })
})
