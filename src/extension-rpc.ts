/**
 * Phase 0 contract for a sandbox extension RPC boundary (FEAT-0081).
 *
 * This module deliberately has no iframe/DOM dependency. The bootstrap owns the
 * `Window.postMessage` source check and transfers one `MessagePort`; this peer owns
 * only the versioned envelopes, capabilities, and lifecycle on that port.
 */

export type RpcValue =
  | null
  | boolean
  | number
  | string
  | readonly RpcValue[]
  | { readonly [key: string]: RpcValue }

export interface RpcMessageEvent {
  data: unknown
}

export interface RpcEndpoint {
  postMessage(message: unknown): void
  addEventListener(type: "message", listener: (event: RpcMessageEvent) => void): void
  removeEventListener(type: "message", listener: (event: RpcMessageEvent) => void): void
  start?(): void
  close?(): void
}

export type RpcErrorCode =
  | "disposed"
  | "timeout"
  | "not_started"
  | "not_ready"
  | "protocol"
  | "unauthorized"
  | "unknown_method"
  | "invalid_value"
  | "handler_error"

export class RpcError extends Error {
  readonly code: RpcErrorCode

  constructor(code: RpcErrorCode, message: string) {
    super(message)
    this.name = "RpcError"
    this.code = code
  }
}

export type RpcHandler = (params: RpcValue) => RpcValue | Promise<RpcValue>

export interface ExtensionRpcPeerOptions {
  /** Fresh per-iframe secret carried in every envelope. */
  nonce: string
  /** Maximum time allowed for a remote capability call. Defaults to 5 seconds. */
  timeoutMs?: number
}

const CHANNEL = "brulion-extension-rpc" as const
const VERSION = 1 as const
const DEFAULT_TIMEOUT_MS = 5_000
const MAX_NONCE_LENGTH = 256
const MAX_ID_LENGTH = 128
const MAX_METHOD_LENGTH = 128
const MAX_ERROR_LENGTH = 256
const METHOD_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/

interface HelloEnvelope {
  readonly channel: typeof CHANNEL
  readonly version: typeof VERSION
  readonly type: "hello"
  readonly nonce: string
}

interface ReadyEnvelope {
  readonly channel: typeof CHANNEL
  readonly version: typeof VERSION
  readonly type: "ready"
  readonly nonce: string
}

interface RequestEnvelope {
  readonly channel: typeof CHANNEL
  readonly version: typeof VERSION
  readonly type: "request"
  readonly nonce: string
  readonly id: string
  readonly method: string
  readonly params: RpcValue
}

interface ResponseEnvelope {
  readonly channel: typeof CHANNEL
  readonly version: typeof VERSION
  readonly type: "response"
  readonly nonce: string
  readonly id: string
  readonly ok: boolean
  readonly result?: RpcValue
  readonly error?: { readonly code: RpcErrorCode; readonly message: string }
}

interface ErrorEnvelope {
  readonly channel: typeof CHANNEL
  readonly version: typeof VERSION
  readonly type: "error"
  readonly nonce: string
  readonly id?: string
  readonly error: { readonly code: RpcErrorCode; readonly message: string }
}

interface ShutdownEnvelope {
  readonly channel: typeof CHANNEL
  readonly version: typeof VERSION
  readonly type: "shutdown"
  readonly nonce: string
}

type RpcEnvelope = HelloEnvelope | ReadyEnvelope | RequestEnvelope | ResponseEnvelope | ErrorEnvelope | ShutdownEnvelope

interface PendingCall {
  readonly resolve: (value: RpcValue) => void
  readonly reject: (reason: RpcError) => void
  readonly timer: ReturnType<typeof setTimeout>
}

interface PlainRecord {
  readonly [key: string]: unknown
}

/**
 * Return true only for values safe to put on the extension wire. In particular,
 * class instances (including FileSystemHandle), functions, cycles, and structured-
 * clone-only values are rejected even though `postMessage` could carry some of them.
 */
export function isRpcValue(value: unknown): value is RpcValue {
  return isRpcValueSeen(value, new Set<object>())
}

function isRpcValueSeen(value: unknown, seen: Set<object>): value is RpcValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return true
  if (typeof value === "number") return Number.isFinite(value)
  if (typeof value !== "object") return false

  const object = value as object
  if (seen.has(object)) return false
  seen.add(object)
  try {
    if (Array.isArray(value)) return value.every((item) => isRpcValueSeen(item, seen))
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return false
    const record = value as Record<string, unknown>
    return Object.keys(record).every((key) => isRpcValueSeen(record[key], seen))
  } catch {
    // Proxies and exotic host objects are not a safe wire value.
    return false
  } finally {
    seen.delete(object)
  }
}

function asPlainRecord(value: unknown): PlainRecord | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null
  try {
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null ? (value as PlainRecord) : null
  } catch {
    return null
  }
}

function validBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength
}

function validNonce(value: unknown): value is string {
  return validBoundedString(value, MAX_NONCE_LENGTH)
}

function validId(value: unknown): value is string {
  return validBoundedString(value, MAX_ID_LENGTH) && ID_PATTERN.test(value)
}

function validMethod(value: unknown): value is string {
  return validBoundedString(value, MAX_METHOD_LENGTH) && METHOD_PATTERN.test(value)
}

function isRpcErrorCode(value: unknown): value is RpcErrorCode {
  return (
    value === "disposed" ||
    value === "timeout" ||
    value === "not_started" ||
    value === "not_ready" ||
    value === "protocol" ||
    value === "unauthorized" ||
    value === "unknown_method" ||
    value === "invalid_value" ||
    value === "handler_error"
  )
}

function boundedMessage(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_ERROR_LENGTH
}

function rawId(value: unknown): string | undefined {
  const record = asPlainRecord(value)
  return record && validId(record.id) ? record.id : undefined
}

function rawType(value: unknown): string | undefined {
  const record = asPlainRecord(value)
  return record && typeof record.type === "string" ? record.type : undefined
}

function rawNonce(value: unknown): string | undefined {
  const record = asPlainRecord(value)
  return record && typeof record.nonce === "string" ? record.nonce : undefined
}

function parseError(value: unknown): { readonly code: RpcErrorCode; readonly message: string } | null {
  const record = asPlainRecord(value)
  if (!record || !exactKeys(record, ["code", "message"]) || !isRpcErrorCode(record.code) || !boundedMessage(record.message)) return null
  return { code: record.code, message: record.message }
}

function exactKeys(record: PlainRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(record).sort()
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index])
}

function parseEnvelope(value: unknown): RpcEnvelope | null {
  const record = asPlainRecord(value)
  if (
    !record ||
    record.channel !== CHANNEL ||
    record.version !== VERSION ||
    !validNonce(record.nonce) ||
    typeof record.type !== "string"
  ) {
    return null
  }

  switch (record.type) {
    case "hello":
      if (!exactKeys(record, ["channel", "version", "type", "nonce"])) return null
      return { channel: CHANNEL, version: VERSION, type: "hello", nonce: record.nonce }
    case "ready":
      if (!exactKeys(record, ["channel", "version", "type", "nonce"])) return null
      return { channel: CHANNEL, version: VERSION, type: "ready", nonce: record.nonce }
    case "shutdown":
      if (!exactKeys(record, ["channel", "version", "type", "nonce"])) return null
      return { channel: CHANNEL, version: VERSION, type: "shutdown", nonce: record.nonce }
    case "request":
      if (!exactKeys(record, ["channel", "version", "type", "nonce", "id", "method", "params"])) return null
      if (!validId(record.id) || !validMethod(record.method) || !("params" in record)) return null
      if (!isRpcValue(record.params)) return null
      return {
        channel: CHANNEL,
        version: VERSION,
        type: "request",
        nonce: record.nonce,
        id: record.id,
        method: record.method,
        params: record.params,
      }
    case "response": {
      if (!validId(record.id) || typeof record.ok !== "boolean" || (record.ok && !exactKeys(record, ["channel", "version", "type", "nonce", "id", "ok", "result"])) || (!record.ok && !exactKeys(record, ["channel", "version", "type", "nonce", "id", "ok", "error"]))) return null
      if (record.ok) {
        if (!("result" in record) || !isRpcValue(record.result)) return null
        return {
          channel: CHANNEL,
          version: VERSION,
          type: "response",
          nonce: record.nonce,
          id: record.id,
          ok: true,
          result: record.result,
        }
      }
      const error = parseError(record.error)
      if (!error) return null
      return {
        channel: CHANNEL,
        version: VERSION,
        type: "response",
        nonce: record.nonce,
        id: record.id,
        ok: false,
        error,
      }
    }
    case "error": {
      const error = parseError(record.error)
      const hasId = "id" in record
      if (!exactKeys(record, hasId ? ["channel", "version", "type", "nonce", "id", "error"] : ["channel", "version", "type", "nonce", "error"])) return null
      if (!error || (hasId && !validId(record.id))) return null
      const id = hasId ? (record.id as string) : undefined
      return {
        channel: CHANNEL,
        version: VERSION,
        type: "error",
        nonce: record.nonce,
        ...(id === undefined ? {} : { id }),
        error,
      }
    }
    default:
      return null
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length <= MAX_ERROR_LENGTH) return error.message
  return "Capability handler failed"
}

/**
 * Symmetric peer for the host and the sandbox script. Both sides call `start()`;
 * the hello/ready exchange marks the dedicated port ready before `call()` works.
 */
export class ExtensionRpcPeer {
  private readonly endpoint: RpcEndpoint
  private readonly nonce: string
  private readonly timeoutMs: number
  private readonly handlers = new Map<string, RpcHandler>()
  private readonly pending = new Map<string, PendingCall>()
  private readonly readyPromise: Promise<void>
  private resolveReady!: () => void
  private rejectReady!: (reason: RpcError) => void
  private readonly onMessage = (event: RpcMessageEvent): void => {
    this.handleMessage(event.data)
  }
  private state: "new" | "started" | "ready" | "disposed" = "new"
  private sawHello = false
  private nextRequestId = 0

  constructor(endpoint: RpcEndpoint, options: ExtensionRpcPeerOptions) {
    if (!validNonce(options.nonce)) throw new TypeError("RPC nonce must be a non-empty bounded string")
    if (
      options.timeoutMs !== undefined &&
      (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)
    ) {
      throw new TypeError("RPC timeout must be a positive finite number")
    }
    this.endpoint = endpoint
    this.nonce = options.nonce
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
    })
  }

  /** Attach the listener and send the nonce-bound hello envelope once. */
  start(): void {
    if (this.state === "disposed") throw new RpcError("disposed", "RPC peer is disposed")
    if (this.state !== "new") return
    this.state = "started"
    this.endpoint.addEventListener("message", this.onMessage)
    this.endpoint.start?.()
    if (!this.post({ channel: CHANNEL, version: VERSION, type: "hello", nonce: this.nonce })) {
      this.dispose()
      throw new RpcError("disposed", "RPC port could not be opened")
    }
  }

  /** Resolves after a valid hello/ready exchange; rejects if disposed first. */
  ready(): Promise<void> {
    if (this.state === "disposed") return Promise.reject(new RpcError("disposed", "RPC peer is disposed"))
    return this.readyPromise
  }

  /** Register one capability and return a revoker for this exact handler. */
  register(method: string, handler: RpcHandler): () => void {
    if (this.state === "disposed") throw new RpcError("disposed", "RPC peer is disposed")
    if (!validMethod(method)) throw new TypeError("Invalid RPC method")
    if (typeof handler !== "function") throw new TypeError("RPC handler must be a function")
    if (this.handlers.has(method)) throw new TypeError(`RPC method already registered: ${method}`)
    this.handlers.set(method, handler)
    return () => {
      if (this.handlers.get(method) === handler) this.handlers.delete(method)
    }
  }

  /** Call a registered remote capability with JSON-like data only. */
  call(method: string, params: RpcValue = null): Promise<RpcValue> {
    if (this.state === "disposed") return Promise.reject(new RpcError("disposed", "RPC peer is disposed"))
    if (this.state === "new") return Promise.reject(new RpcError("not_started", "RPC peer has not started"))
    if (this.state !== "ready") return Promise.reject(new RpcError("not_ready", "RPC peer is not ready"))
    if (!validMethod(method)) return Promise.reject(new RpcError("protocol", "Invalid RPC method"))
    if (!isRpcValue(params)) return Promise.reject(new RpcError("invalid_value", "RPC params are not JSON-like"))

    const id = `r${++this.nextRequestId}`
    const request: RequestEnvelope = {
      channel: CHANNEL,
      version: VERSION,
      type: "request",
      nonce: this.nonce,
      id,
      method,
      params,
    }

    return new Promise<RpcValue>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pending.get(id)
        if (!pending) return
        this.pending.delete(id)
        pending.reject(new RpcError("timeout", `RPC call timed out: ${method}`))
      }, this.timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      if (!this.post(request)) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(new RpcError("disposed", "RPC peer is disposed"))
      }
    })
  }

  /** Close the port, reject pending calls, and notify the authenticated peer. */
  dispose(): void {
    if (this.state === "disposed") return
    try {
      this.endpoint.postMessage({ channel: CHANNEL, version: VERSION, type: "shutdown", nonce: this.nonce })
    } catch {
      // The endpoint may already be closed; local disposal still proceeds.
    }
    this.state = "disposed"
    this.endpoint.removeEventListener("message", this.onMessage)
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new RpcError("disposed", "RPC peer is disposed"))
    }
    this.pending.clear()
    this.rejectReady(new RpcError("disposed", "RPC peer is disposed"))
    this.endpoint.close?.()
  }

  private post(message: RpcEnvelope): boolean {
    if (this.state === "disposed") return false
    try {
      this.endpoint.postMessage(message)
      return true
    } catch {
      return false
    }
  }

  private sendError(code: RpcErrorCode, message: string, id?: string): void {
    this.post({
      channel: CHANNEL,
      version: VERSION,
      type: "error",
      nonce: this.nonce,
      ...(id === undefined ? {} : { id }),
      error: { code, message: message.slice(0, MAX_ERROR_LENGTH) },
    })
  }

  private sendResponseError(id: string, code: RpcErrorCode, message: string): void {
    this.post({
      channel: CHANNEL,
      version: VERSION,
      type: "response",
      nonce: this.nonce,
      id,
      ok: false,
      error: { code, message: message.slice(0, MAX_ERROR_LENGTH) },
    })
  }

  private handleMessage(raw: unknown): void {
    if (this.state === "disposed") return
    const nonce = rawNonce(raw)
    const type = rawType(raw)
    if (nonce !== this.nonce) {
      // Never answer a foreign response (that could create an error ping-pong),
      // but reject a hostile request/hello with a response on our authenticated port.
      if (type === "request" || type === "hello") {
        this.sendError("unauthorized", "RPC nonce mismatch", rawId(raw))
      }
      return
    }

    const envelope = parseEnvelope(raw)
    if (!envelope) {
      this.sendError("protocol", "Malformed RPC envelope", rawId(raw))
      return
    }
    switch (envelope.type) {
      case "hello":
        this.handleHello()
        break
      case "ready":
        this.handleReady()
        break
      case "request":
        void this.handleRequest(envelope)
        break
      case "response":
        this.handleResponse(envelope)
        break
      case "error":
        this.handleError(envelope)
        break
      case "shutdown":
        this.disposeFromRemote()
        break
    }
  }

  private disposeFromRemote(): void {
    if (this.state === "disposed") return
    this.state = "disposed"
    this.endpoint.removeEventListener("message", this.onMessage)
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new RpcError("disposed", "RPC peer is disposed"))
    }
    this.pending.clear()
    this.rejectReady(new RpcError("disposed", "RPC peer is disposed"))
    this.endpoint.close?.()
  }

  private handleHello(): void {
    if (this.state === "new") {
      this.sendError("not_started", "RPC peer has not started")
      return
    }
    this.sawHello = true
    this.post({ channel: CHANNEL, version: VERSION, type: "ready", nonce: this.nonce })
  }

  private handleReady(): void {
    if (!this.sawHello) {
      this.sendError("protocol", "RPC ready arrived before hello")
      return
    }
    if (this.state !== "ready") {
      this.state = "ready"
      this.resolveReady()
    }
  }

  private async handleRequest(request: RequestEnvelope): Promise<void> {
    if (this.state !== "ready") {
      this.sendResponseError(request.id, "not_ready", "RPC peer is not ready")
      return
    }
    const handler = this.handlers.get(request.method)
    if (!handler) {
      this.sendResponseError(request.id, "unknown_method", `Unknown RPC method: ${request.method}`)
      return
    }
    try {
      const result = await handler(request.params)
      if (!isRpcValue(result)) {
        this.sendResponseError(request.id, "invalid_value", "RPC result is not JSON-like")
        return
      }
      this.post({
        channel: CHANNEL,
        version: VERSION,
        type: "response",
        nonce: this.nonce,
        id: request.id,
        ok: true,
        result,
      })
    } catch (error) {
      const code = error instanceof RpcError && (error.code === "timeout" || error.code === "disposed")
        ? error.code
        : "handler_error"
      this.sendResponseError(request.id, code, errorMessage(error))
    }
  }

  private handleResponse(response: ResponseEnvelope): void {
    const pending = this.pending.get(response.id)
    if (!pending) return
    this.pending.delete(response.id)
    clearTimeout(pending.timer)
    if (response.ok) {
      pending.resolve(response.result as RpcValue)
    } else {
      pending.reject(new RpcError(response.error?.code ?? "protocol", response.error?.message ?? "RPC failed"))
    }
  }

  private handleError(error: ErrorEnvelope): void {
    if (!error.id) return
    const pending = this.pending.get(error.id)
    if (!pending) return
    this.pending.delete(error.id)
    clearTimeout(pending.timer)
    pending.reject(new RpcError(error.error.code, error.error.message))
  }
}
