import type { Action } from "./actions"
import {
  ExtensionHost,
  type ExtensionEditorCapabilities,
  type ExtensionNoteCapabilities,
} from "./extension-host"
import { ExtensionRpcPeer, type RpcValue } from "./extension-rpc"
import { MAX_SCRIPT_SOURCE_BYTES } from "./script-storage"
import type { ScriptManifest } from "./script-manifest"
import type { ExtensionNavigationCapabilities } from "./extension-navigation"

export const EXTENSION_BOOTSTRAP_CHANNEL = "brulion-extension-bootstrap" as const
export const DEFAULT_EXTENSION_TIMEOUT_MS = 5_000 as const

/** The child document is opaque-origin and has no network-capable CSP source. */
export function createExtensionBootstrapHtml(): string {
  return String.raw`<!doctype html>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; object-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none';">
<script>
(() => {
  "use strict"
  const CHANNEL = "brulion-extension-rpc"
  const VERSION = 1
  const BOOTSTRAP = "brulion-extension-bootstrap"
  const MAX_ERROR_LENGTH = 256
  const MAX_TIMEOUT_MS = 5000
  let port = null
  let nonce = null
  let state = "new"
  let sawHello = false
  let nextId = 0
  const pending = new Map()
  const handlers = new Map()

  function finite(value) {
    return typeof value === "number" && Number.isFinite(value)
  }

  function rpcValue(value, seen) {
    if (value === null || typeof value === "string" || typeof value === "boolean") return true
    if (finite(value)) return true
    if (!value || typeof value !== "object") return false
    const objects = seen || new Set()
    if (objects.has(value)) return false
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return false
    objects.add(value)
    try {
      if (Array.isArray(value)) return value.every((item) => rpcValue(item, objects))
      return Object.keys(value).every((key) => rpcValue(value[key], objects))
    } finally {
      objects.delete(value)
    }
  }

  function message(type, fields) {
    return Object.assign({ channel: CHANNEL, version: VERSION, type, nonce }, fields || {})
  }

  function send(type, fields) {
    if (state === "disposed" || !port) return false
    try {
      port.postMessage(message(type, fields))
      return true
    } catch (_) {
      return false
    }
  }

  function errorText(error) {
    const text = error && typeof error.message === "string" ? error.message : "Capability failed"
    return text.slice(0, MAX_ERROR_LENGTH)
  }

  function responseError(id, code, text) {
    send("response", { id, ok: false, error: { code, message: String(text).slice(0, MAX_ERROR_LENGTH) } })
  }

  function call(method, params) {
    if (state === "disposed") return Promise.reject(new Error("RPC peer is disposed"))
    if (state !== "ready") return Promise.reject(new Error("RPC peer is not ready"))
    if (!rpcValue(params)) return Promise.reject(new Error("RPC params are not JSON-like"))
    const id = "child-" + (++nextId)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!pending.has(id)) return
        pending.delete(id)
        reject(new Error("RPC call timed out: " + method))
      }, MAX_TIMEOUT_MS)
      pending.set(id, { resolve, reject, timer })
      if (!send("request", { id, method, params })) {
        clearTimeout(timer)
        pending.delete(id)
        reject(new Error("RPC peer is disposed"))
      }
    })
  }

  function handleResponse(data) {
    const item = pending.get(data.id)
    if (!item) return
    pending.delete(data.id)
    clearTimeout(item.timer)
    if (data.ok) item.resolve(data.result)
    else item.reject(new Error(data.error && data.error.message ? data.error.message : "RPC failed"))
  }

  async function handleRequest(data) {
    if (state !== "ready") {
      responseError(data.id, "not_ready", "RPC peer is not ready")
      return
    }
    const handler = handlers.get(data.method)
    if (!handler) {
      responseError(data.id, "unknown_method", "Unknown RPC method: " + data.method)
      return
    }
    try {
      const result = await handler(data.params)
      const safeResult = result === undefined ? null : result
      if (!rpcValue(safeResult)) {
        responseError(data.id, "invalid_value", "RPC result is not JSON-like")
        return
      }
      send("response", { id: data.id, ok: true, result: safeResult })
    } catch (error) {
      responseError(data.id, "handler_error", errorText(error))
    }
  }

  function handle(data) {
    if (!data || data.channel !== CHANNEL || data.version !== VERSION || data.nonce !== nonce) return
    if (data.type === "hello") {
      sawHello = true
      send("ready")
      return
    }
    if (data.type === "ready") {
      if (sawHello) state = "ready"
      return
    }
    if (data.type === "response") {
      handleResponse(data)
      return
    }
    if (data.type === "request") void handleRequest(data)
  }

  function register(method, handler) {
    handlers.set(method, handler)
  }

  async function activate(source, entry) {
    const commandHandlers = new Map()
    const api = {
      commands: {
        register: async (metadata, run) => {
          if (!metadata || typeof metadata !== "object" || typeof run !== "function") {
            throw new Error("commands.register requires metadata and a callback")
          }
          commandHandlers.set(metadata.id, run)
          try {
            return await call("commands.register", metadata)
          } catch (error) {
            commandHandlers.delete(metadata.id)
            throw error
          }
        },
        unregister: async (id) => {
          const result = await call("commands.unregister", { id })
          commandHandlers.delete(id)
          return result
        },
      },
      editor: {
        getText: () => call("editor.getText", null),
        getSelection: () => call("editor.getSelection", null),
        replaceSelection: (text) => call("editor.replaceSelection", { text }),
        focus: () => call("editor.focus", null),
      },
      notes: {
        list: () => call("notes.list", null),
        read: (path) => call("notes.read", { path }),
        create: (path) => call("notes.create", { path }),
        write: (path, content, expectedLastModified) => call("notes.write", { path, content, expectedLastModified }),
        delete: (path) => call("notes.delete", { path }),
        move: (from, to) => call("notes.move", { from, to }),
      },
      navigation: {
        getActiveNote: () => call("navigation.getActiveNote", null),
        openNote: (path, options) => call("navigation.openNote", { path, ...(options === undefined ? {} : { options }) }),
        resolveLink: (target, options) => call("navigation.resolveLink", { target, ...(options === undefined ? {} : { options }) }),
      },
    }
    globalThis.brulion = Object.freeze(api)
    register("commands.invoke", async (params) => {
      const id = params && typeof params.id === "string" ? params.id : ""
      const callback = commandHandlers.get(id)
      if (!callback) throw new Error("Command is not registered: " + id)
      const result = await callback()
      return result === undefined ? null : result
    })

    const moduleUrl = URL.createObjectURL(new Blob([source + "\n//# sourceURL=brulion-extension:" + entry], { type: "text/javascript" }))
    try {
      const module = await import(moduleUrl)
      const activation = module.default || module.activate
      if (typeof activation === "function") await activation(api)
    } finally {
      URL.revokeObjectURL(moduleUrl)
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || !event.data || event.data.channel !== BOOTSTRAP || !event.ports[0]) return
    if (state !== "new") return
    nonce = typeof event.data.nonce === "string" ? event.data.nonce : null
    if (!nonce || typeof event.data.source !== "string" || typeof event.data.entry !== "string") return
    port = event.ports[0]
    state = "started"
    port.addEventListener("message", (messageEvent) => handle(messageEvent.data))
    port.start()
    send("hello")
    Promise.resolve()
      .then(() => new Promise((resolve) => {
        const check = () => state === "ready" ? resolve() : setTimeout(check, 0)
        check()
      }))
      .then(() => activate(event.data.source, event.data.entry))
      .then(() => call("runtime.ready", null))
      .catch(async (error) => {
        try { await call("runtime.error", { message: errorText(error) }) } catch (_) {}
      })
  }, { once: true })
})()
</script>`
}

export interface ExtensionRunnerOptions {
  manifest: ScriptManifest
  source: string
  editor: ExtensionEditorCapabilities
  notes: ExtensionNoteCapabilities
  navigation?: ExtensionNavigationCapabilities
  container?: HTMLElement
  onActionsChanged?: () => void
  onError?: (error: unknown) => void
  timeoutMs?: number
}

function nonce(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID()
  return `brulion-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function runtimeError(params: RpcValue): string {
  if (typeof params !== "object" || params === null || Array.isArray(params)) return "Extension runtime failed"
  const message = (params as { readonly [key: string]: RpcValue }).message
  return typeof message === "string" && message.length > 0 ? message : "Extension runtime failed"
}

/**
 * Owns one sandboxed iframe, one nonce-bound RPC peer, and one ExtensionHost.
 * The runner intentionally has no vault discovery logic: callers load/validate
 * a ScriptRecord first and inject application capabilities here.
 */
export class ExtensionRunner {
  private readonly options: ExtensionRunnerOptions
  private readonly bootstrapNonce = nonce()
  private readonly frame: HTMLIFrameElement
  private readonly peer: ExtensionRpcPeer
  private readonly host: ExtensionHost
  private readonly runtimeReady: Promise<void>
  private resolveRuntimeReady!: () => void
  private rejectRuntimeReady!: (reason: Error) => void
  private runtimeSettled = false
  private startPromise: Promise<void> | null = null
  private disposed = false

  constructor(options: ExtensionRunnerOptions) {
    if (new TextEncoder().encode(options.source).byteLength > MAX_SCRIPT_SOURCE_BYTES) {
      throw new TypeError("Extension source exceeds the script size limit")
    }
    this.options = options
    const parent = options.container ?? document.body
    const frame = document.createElement("iframe")
    frame.sandbox.add("allow-scripts")
    frame.hidden = true
    frame.setAttribute("aria-hidden", "true")
    frame.title = `Brulion extension: ${options.manifest.name}`
    parent.append(frame)
    this.frame = frame

    const channel = new MessageChannel()
    this.peer = new ExtensionRpcPeer(channel.port1, {
      nonce: this.bootstrapNonce,
      timeoutMs: options.timeoutMs,
    })
    this.runtimeReady = new Promise<void>((resolve, reject) => {
      this.resolveRuntimeReady = resolve
      this.rejectRuntimeReady = reject
    })
    this.peer.register("runtime.ready", () => {
      if (!this.runtimeSettled) {
        this.runtimeSettled = true
        this.resolveRuntimeReady()
      }
      return null
    })
    this.peer.register("runtime.error", (params) => {
      const error = new Error(runtimeError(params))
      this.reportError(error)
      if (!this.runtimeSettled) {
        this.runtimeSettled = true
        this.rejectRuntimeReady(error)
      }
      return null
    })
    this.host = new ExtensionHost({
      scriptId: options.manifest.id,
      peer: this.peer,
      editor: options.editor,
      notes: options.notes,
      navigation: options.navigation,
      permissions: options.manifest.permissions,
      onActionsChanged: options.onActionsChanged,
      onError: options.onError,
    })

    const transfer = channel.port2
    frame.addEventListener(
      "load",
      () => {
        if (this.disposed || !frame.contentWindow) return
        frame.contentWindow.postMessage(
          {
            channel: EXTENSION_BOOTSTRAP_CHANNEL,
            nonce: this.bootstrapNonce,
            source: options.source,
            entry: options.manifest.entry,
          },
          "*",
          [transfer],
        )
      },
      { once: true },
    )
    frame.srcdoc = createExtensionBootstrapHtml()
  }

  start(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error("Extension runner is disposed"))
    if (this.startPromise) return this.startPromise
    this.startPromise = this.startInternal().catch((error: unknown) => {
      this.dispose()
      throw error
    })
    return this.startPromise
  }

  getActions(): Action[] {
    return this.host.getActions()
  }

  isRunning(): boolean {
    return !this.disposed && this.runtimeSettled
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.host.dispose()
    this.frame.remove()
  }

  private async startInternal(): Promise<void> {
    this.peer.start()
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_EXTENSION_TIMEOUT_MS
    await this.waitForLifecycle(this.host.ready(), "Extension RPC handshake", timeoutMs)
    await this.waitForLifecycle(this.runtimeReady, "Extension activation", timeoutMs)
  }

  private waitForLifecycle(
    promise: Promise<void>,
    phase: string,
    timeoutMs: number,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        reject(new Error(`${phase} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      promise.then(
        () => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve()
        },
        (error: unknown) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          reject(error)
        },
      )
    })
  }

  private reportError(error: unknown): void {
    try {
      this.options.onError?.(error)
    } catch {
      // Error observers are not allowed to break extension lifecycle cleanup.
    }
  }
}
