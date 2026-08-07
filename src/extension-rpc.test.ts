import { describe, expect, it, vi } from "vitest"
import { ExtensionRpcPeer, type RpcEndpoint, type RpcValue } from "./extension-rpc"

type Listener = (event: { data: unknown }) => void

/** A deterministic MessagePort-shaped pair; no browser globals are needed. */
class FakePort implements RpcEndpoint {
  peer: FakePort | null = null
  private readonly listeners = new Set<Listener>()
  private closed = false
  readonly sent: unknown[] = []

  postMessage(message: unknown): void {
    if (this.closed) throw new Error("port closed")
    this.sent.push(message)
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

  dispatch(data: unknown): void {
    if (this.closed) return
    for (const listener of this.listeners) listener({ data })
  }

  listenerCount(): number {
    return this.listeners.size
  }
}

function channel(): [FakePort, FakePort] {
  const left = new FakePort()
  const right = new FakePort()
  left.peer = right
  right.peer = left
  return [left, right]
}

function envelope(type: string, nonce = "nonce-1"): Record<string, unknown> {
  return { channel: "brulion-extension-rpc", version: 1, type, nonce }
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(resolve))
}

describe("FEAT-0081 ExtensionRpcPeer", () => {
  it("performs a nonce-bound handshake and calls an allow-listed capability", async () => {
    const [hostPort, extensionPort] = channel()
    const host = new ExtensionRpcPeer(hostPort, { nonce: "nonce-1", timeoutMs: 50 })
    const extension = new ExtensionRpcPeer(extensionPort, { nonce: "nonce-1", timeoutMs: 50 })
    const read = vi.fn((params: RpcValue) => ({ text: (params as { note: string }).note }))
    host.register("editor.read", read)

    host.start()
    extension.start()
    await Promise.all([host.ready(), extension.ready()])

    await expect(extension.call("editor.read", { note: "hello" })).resolves.toEqual({
      text: "hello",
    })
    expect(read).toHaveBeenCalledWith({ note: "hello" })
  })

  it("rejects unknown, malformed, and wrong-nonce messages before dispatch", async () => {
    const [hostPort, extensionPort] = channel()
    const host = new ExtensionRpcPeer(hostPort, { nonce: "nonce-1", timeoutMs: 50 })
    const secret = vi.fn(() => "should not run")
    host.register("secret", secret)
    const extension = new ExtensionRpcPeer(extensionPort, { nonce: "nonce-1", timeoutMs: 50 })
    host.start()
    extension.start()
    await Promise.all([host.ready(), extension.ready()])

    await expect(extension.call("missing", null)).rejects.toMatchObject({ code: "unknown_method" })
    expect(secret).not.toHaveBeenCalled()

    hostPort.dispatch({
      ...envelope("request", "wrong-nonce"),
      id: "hostile-1",
      method: "secret",
      params: null,
    })
    await settle()
    expect(hostPort.sent.at(-1)).toMatchObject({
      type: "error",
      error: { code: "unauthorized" },
    })
    expect(secret).not.toHaveBeenCalled()

    hostPort.dispatch({ ...envelope("request"), id: "hostile-2", method: "secret" })
    await settle()
    expect(hostPort.sent.at(-1)).toMatchObject({
      type: "error",
      error: { code: "protocol" },
    })
    expect(secret).not.toHaveBeenCalled()
  })

  it("only allows JSON-like values and rejects handle-shaped class instances", async () => {
    const [hostPort, extensionPort] = channel()
    const host = new ExtensionRpcPeer(hostPort, { nonce: "nonce-1", timeoutMs: 50 })
    const extension = new ExtensionRpcPeer(extensionPort, { nonce: "nonce-1", timeoutMs: 50 })
    host.register("echo", (params) => params)
    host.register("bad-result", () => new Date() as unknown as RpcValue)
    host.start()
    extension.start()
    await Promise.all([host.ready(), extension.ready()])

    await expect(
      extension.call("echo", new Date() as unknown as RpcValue),
    ).rejects.toMatchObject({ code: "invalid_value" })
    await expect(extension.call("bad-result", null)).rejects.toMatchObject({
      code: "invalid_value",
    })

    class FakeFileSystemHandle {
      readonly kind = "file"
      readonly name = "secret.md"
      queryPermission(): Promise<"granted"> {
        return Promise.resolve("granted")
      }
    }
    await expect(
      extension.call("echo", new FakeFileSystemHandle() as unknown as RpcValue),
    ).rejects.toMatchObject({ code: "invalid_value" })
  })

  it("times out a hung call and disposal rejects pending work and removes listeners", async () => {
    const [hostPort, extensionPort] = channel()
    const host = new ExtensionRpcPeer(hostPort, { nonce: "nonce-1", timeoutMs: 10 })
    const extension = new ExtensionRpcPeer(extensionPort, { nonce: "nonce-1", timeoutMs: 10 })
    host.register("hang", () => new Promise<RpcValue>(() => {}))
    host.start()
    extension.start()
    await Promise.all([host.ready(), extension.ready()])

    await expect(extension.call("hang", null)).rejects.toMatchObject({ code: "timeout" })

    const pending = extension.call("hang", null)
    extension.dispose()
    await expect(pending).rejects.toMatchObject({ code: "disposed" })
    expect(extensionPort.listenerCount()).toBe(0)
    expect(() => extensionPort.dispatch({ ...envelope("response"), id: "r-2", ok: true, result: null })).not.toThrow()
    await expect(extension.call("hang", null)).rejects.toMatchObject({ code: "disposed" })
  })
})
