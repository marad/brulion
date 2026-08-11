import type { Action } from "./actions"
import { normalizeNoteName } from "./note-name"
import type {
  CreateResult,
  MoveResult,
  NoteContent,
  SaveResult,
} from "./note"
import {
  ExtensionRpcPeer,
  type RpcValue,
} from "./extension-rpc"
import {
  SCRIPT_PERMISSIONS,
  validateScriptId,
  type ScriptPermission,
} from "./script-manifest"
import { resolveExtensionIcon, sanitizeExtensionIconName } from "./extension-icons"
import type {
  ActiveNote,
  ExtensionNavigationCapabilities,
  LinkResolution,
  OpenNoteOptions,
  OpenNoteResult,
  ResolveLinkOptions,
} from "./extension-navigation"

/** Maximum number of commands one extension may publish in the MVP host. */
export const MAX_EXTENSION_COMMANDS = 64
const MAX_COMMAND_ID_LENGTH = 64
const MAX_COMMAND_LABEL_LENGTH = 120
const MAX_COMMAND_DESCRIPTION_LENGTH = 240
const COMMAND_ID = /^[a-z][a-z0-9]*(?:[-_.][a-z0-9]+)*$/
const BRULION_DIRECTORY = ".brulion"
const MAX_NAVIGATION_TARGET_LENGTH = 4096
const MAX_NAVIGATION_ANCHOR_LENGTH = 512

/** Every public capability registered by the host-side extension bridge. */
export const EXTENSION_API_METHODS = [
  "commands.register",
  "commands.unregister",
  "editor.getText",
  "editor.getSelection",
  "editor.replaceSelection",
  "editor.focus",
  "notes.list",
  "notes.read",
  "notes.create",
  "notes.write",
  "notes.delete",
  "notes.move",
  "navigation.getActiveNote",
  "navigation.openNote",
  "navigation.resolveLink",
] as const

export interface ExtensionSelection {
  from: number
  to: number
  text: string
}

/** The editor surface deliberately contains no EditorView or DOM value. */
export interface ExtensionEditorCapabilities {
  getText: () => string | Promise<string>
  getSelection: () => ExtensionSelection | Promise<ExtensionSelection>
  replaceSelection: (text: string) => void | Promise<void>
  focus: () => void | Promise<void>
}

/** Note operations are injected by the application; file handles never cross RPC. */
export interface ExtensionNoteCapabilities {
  list: () => readonly string[] | Promise<readonly string[]>
  read: (path: string) => NoteContent | Promise<NoteContent>
  create: (path: string) => CreateResult | Promise<CreateResult>
  write: (
    path: string,
    content: string,
    expectedLastModified: number | null,
  ) => SaveResult | Promise<SaveResult>
  delete: (path: string) => void | Promise<void>
  move: (from: string, to: string) => MoveResult | Promise<MoveResult>
}

export interface ExtensionHostOptions {
  scriptId: string
  peer: ExtensionRpcPeer
  editor: ExtensionEditorCapabilities
  notes: ExtensionNoteCapabilities
  /** Active-view callbacks; omitted when the runner has no navigation binding. */
  navigation?: ExtensionNavigationCapabilities
  /** Called after this host's action list changes. Errors are isolated. */
  onActionsChanged?: () => void
  /** Receives action invocation/notification errors without breaking the host. */
  onError?: (error: unknown) => void
  maxCommands?: number
  /** Capabilities granted by the validated manifest; omitted means all host API capabilities. */
  permissions?: readonly ScriptPermission[]
}

interface CommandRegistration {
  readonly id: string
  readonly label: string
  readonly description?: string
  readonly icon: string
}

function record(value: RpcValue, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function boundedString(value: unknown, label: string, maxLength: number, allowEmpty = false): string {
  if (
    typeof value !== "string" ||
    value.length > maxLength ||
    (!allowEmpty && value.length === 0)
  ) {
    throw new Error(`${label} must be a bounded${allowEmpty ? "" : " non-empty"} string`)
  }
  return value
}

function commandRegistration(value: RpcValue): CommandRegistration {
  const params = record(value, "Command registration")
  const id = boundedString(params.id, "Command id", MAX_COMMAND_ID_LENGTH)
  if (!COMMAND_ID.test(id)) throw new Error("Command id has unsafe format")
  const label = boundedString(params.label, "Command label", MAX_COMMAND_LABEL_LENGTH).trim()
  if (label.length === 0) throw new Error("Command label must not be blank")
  const rawDescription = params.description
  let description: string | undefined
  if (rawDescription !== undefined) {
    description = boundedString(rawDescription, "Command description", MAX_COMMAND_DESCRIPTION_LENGTH).trim()
    if (description.length === 0) throw new Error("Command description must not be blank")
  }
  return {
    id,
    label,
    icon: sanitizeExtensionIconName(params.icon),
    ...(description === undefined ? {} : { description }),
  }
}

function notePath(value: unknown): string {
  const path = boundedString(value, "Note path", 512)
  const normalized = normalizeNoteName(path)
  if (!normalized.ok) throw new Error(normalized.reason)
  if (normalized.filename.split("/", 1)[0]?.toLowerCase() === BRULION_DIRECTORY) {
    throw new Error("Note path targets Brulion metadata")
  }
  return normalized.filename
}

function expectedMtime(value: unknown): number | null {
  if (value === null) return null
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error("Expected lastModified must be a non-negative number or null")
  }
  return value
}

function selectionValue(value: ExtensionSelection): ExtensionSelection {
  if (
    !Number.isSafeInteger(value.from) ||
    !Number.isSafeInteger(value.to) ||
    value.from < 0 ||
    value.to < value.from ||
    typeof value.text !== "string"
  ) {
    throw new Error("Editor selection is invalid")
  }
  return { from: value.from, to: value.to, text: value.text }
}

function noteContentValue(value: NoteContent): NoteContent {
  if (
    typeof value.content !== "string" ||
    (value.lastModified !== null &&
      (typeof value.lastModified !== "number" || !Number.isFinite(value.lastModified) || value.lastModified < 0))
  ) {
    throw new Error("Note content result is invalid")
  }
  return { content: value.content, lastModified: value.lastModified }
}

function saveResultValue(value: SaveResult): SaveResult {
  if (value.status === "conflict") return { status: "conflict" }
  if (value.status === "saved" && Number.isFinite(value.lastModified) && value.lastModified >= 0) {
    return { status: "saved", lastModified: value.lastModified }
  }
  throw new Error("Note write result is invalid")
}

function createResultValue(value: CreateResult): CreateResult {
  if (value.status === "created" || value.status === "exists") return { status: value.status }
  throw new Error("Note create result is invalid")
}

function moveResultValue(value: MoveResult): MoveResult {
  if (value.status === "moved" || value.status === "exists" || value.status === "missing") {
    return { status: value.status }
  }
  throw new Error("Note move result is invalid")
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    if (value.charCodeAt(index) < 0x20) return true
  }
  return false
}

function nullableAnchor(value: unknown, label: string): string | null {
  if (value === null) return null
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_NAVIGATION_ANCHOR_LENGTH ||
    value.includes("#") ||
    hasControlCharacter(value)
  ) {
    throw new Error(`${label} must be a bounded heading slug without #`)
  }
  return value
}

function openNoteOptions(value: unknown): OpenNoteOptions | undefined {
  if (value === undefined) return undefined
  const params = record(value as RpcValue, "Open note options")
  for (const key of Object.keys(params)) {
    if (key !== "anchor") throw new Error("Open note options contain an unknown field")
  }
  if (!("anchor" in params)) return {}
  return { anchor: nullableAnchor(params.anchor, "Anchor") as string }
}

function resolveLinkOptions(value: unknown): ResolveLinkOptions {
  const params = record(value as RpcValue, "Resolve link options")
  for (const key of Object.keys(params)) {
    if (key !== "from" && key !== "kind") throw new Error("Resolve link options contain an unknown field")
  }
  if (params.kind !== "markdown" && params.kind !== "wikilink") {
    throw new Error("Link kind must be markdown or wikilink")
  }
  if (!("from" in params)) return { kind: params.kind }
  return { kind: params.kind, from: notePath(params.from) }
}

function activeNoteValue(value: ActiveNote | null): ActiveNote | null {
  if (value === null) return null
  return { path: notePath(value.path) }
}

function openNoteResultValue(value: OpenNoteResult): OpenNoteResult {
  const result = record(value as unknown as RpcValue, "Open note result")
  if (result.status === "conflict") return { status: "conflict", path: notePath(result.path) }
  if (result.status === "missing") {
    return {
      status: "missing",
      path: notePath(result.path),
      anchor: nullableAnchor(result.anchor, "Open note result anchor"),
    }
  }
  if (result.status !== "opened" && result.status !== "already-open") {
    throw new Error("Open note result is invalid")
  }
  const anchor = nullableAnchor(result.anchor, "Open note result anchor")
  if (
    result.anchorStatus !== "not-requested" &&
    result.anchorStatus !== "found" &&
    result.anchorStatus !== "not-found"
  ) {
    throw new Error("Open note result anchor status is invalid")
  }
  return {
    status: result.status,
    path: notePath(result.path),
    anchor,
    anchorStatus: result.anchorStatus,
  }
}

function linkResolutionValue(value: LinkResolution): LinkResolution {
  const result = record(value as unknown as RpcValue, "Link resolution")
  if (result.status === "external" || result.status === "invalid") {
    return {
      status: result.status,
      target: boundedString(result.target, "Link target", MAX_NAVIGATION_TARGET_LENGTH, true),
    }
  }
  if (result.status !== "resolved" && result.status !== "missing") {
    throw new Error("Link resolution status is invalid")
  }
  return {
    status: result.status,
    path: notePath(result.path),
    anchor: nullableAnchor(result.anchor, "Link resolution anchor"),
  }
}

/**
 * Transport-agnostic host side of the local extension API (FEAT-0083).
 *
 * The host owns application objects and injects only narrow callbacks. The
 * extension side can register commands and call editor/note methods through the
 * authenticated peer, but it never receives a DOM node, editor instance, or
 * File System Access handle.
 */
export class ExtensionHost {
  private readonly scriptId: string
  private readonly peer: ExtensionRpcPeer
  private readonly editor: ExtensionEditorCapabilities
  private readonly notes: ExtensionNoteCapabilities
  private readonly navigation?: ExtensionNavigationCapabilities
  private readonly maxCommands: number
  private readonly onActionsChanged?: () => void
  private readonly onError?: (error: unknown) => void
  private readonly permissions: ReadonlySet<ScriptPermission>
  private readonly commands = new Map<string, { registration: CommandRegistration; action: Action }>()
  private readonly actions: Action[] = []
  private readonly revokeHandlers: Array<() => void> = []
  private disposed = false

  constructor(options: ExtensionHostOptions) {
    const scriptId = validateScriptId(options.scriptId)
    if (!scriptId.ok) throw new TypeError(scriptId.error)
    if (
      options.maxCommands !== undefined &&
      (!Number.isSafeInteger(options.maxCommands) || options.maxCommands <= 0)
    ) {
      throw new TypeError("maxCommands must be a positive integer")
    }
    this.scriptId = scriptId.value
    this.peer = options.peer
    this.editor = options.editor
    this.notes = options.notes
    this.navigation = options.navigation
    this.maxCommands = options.maxCommands ?? MAX_EXTENSION_COMMANDS
    this.onActionsChanged = options.onActionsChanged
    this.onError = options.onError
    this.permissions = new Set(options.permissions ?? SCRIPT_PERMISSIONS)

    this.revokeHandlers.push(
      this.peer.register("commands.register", (params) => this.registerCommand(params)),
      this.peer.register("commands.unregister", (params) => this.unregisterCommand(params)),
      this.peer.register("editor.getText", (params) => this.getText(params)),
      this.peer.register("editor.getSelection", (params) => this.getSelection(params)),
      this.peer.register("editor.replaceSelection", (params) => this.replaceSelection(params)),
      this.peer.register("editor.focus", (params) => this.focus(params)),
      this.peer.register("notes.list", (params) => this.listNotes(params)),
      this.peer.register("notes.read", (params) => this.readNote(params)),
      this.peer.register("notes.create", (params) => this.createNote(params)),
      this.peer.register("notes.write", (params) => this.writeNote(params)),
      this.peer.register("notes.delete", (params) => this.deleteNote(params)),
      this.peer.register("notes.move", (params) => this.moveNote(params)),
      this.peer.register("navigation.getActiveNote", (params) => this.getActiveNote(params)),
      this.peer.register("navigation.openNote", (params) => this.openNote(params)),
      this.peer.register("navigation.resolveLink", (params) => this.resolveLink(params)),
    )
  }

  start(): void {
    this.peer.start()
  }

  ready(): Promise<void> {
    return this.peer.ready()
  }

  /** A snapshot; mutating the returned array cannot mutate another host. */
  getActions(): Action[] {
    return [...this.actions]
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.commands.clear()
    this.actions.length = 0
    for (const revoke of this.revokeHandlers) revoke()
    this.notifyActionsChanged()
    this.peer.dispose()
  }

  private registerCommand(params: RpcValue): RpcValue {
    this.requirePermission("commands")
    const registration = commandRegistration(params)
    if (this.commands.has(registration.id)) throw new Error(`Command already registered: ${registration.id}`)
    if (this.commands.size >= this.maxCommands) throw new Error("Extension command limit reached")
    const actionId = `${this.scriptId}:${registration.id}`
    const action: Action = {
      id: actionId,
      label: registration.label,
      icon: resolveExtensionIcon(registration.icon),
      run: () => {
        void this.invokeCommand(registration.id)
      },
    }
    this.commands.set(registration.id, { registration, action })
    this.actions.push(action)
    this.notifyActionsChanged()
    return { actionId }
  }

  private async invokeCommand(id: string): Promise<void> {
    try {
      await this.peer.call("commands.invoke", { id })
    } catch (error) {
      this.reportError(error)
    }
  }

  private unregisterCommand(params: RpcValue): RpcValue {
    this.requirePermission("commands")
    const id = this.commandId(params)
    const command = this.commands.get(id)
    if (!command) return null
    this.commands.delete(id)
    const index = this.actions.indexOf(command.action)
    if (index >= 0) this.actions.splice(index, 1)
    this.notifyActionsChanged()
    return null
  }

  private commandId(params: RpcValue): string {
    const value = record(params, "Command")
    const id = boundedString(value.id, "Command id", MAX_COMMAND_ID_LENGTH)
    if (!COMMAND_ID.test(id)) throw new Error("Command id has unsafe format")
    return id
  }

  private async getText(_params: RpcValue): Promise<RpcValue> {
    this.requirePermission("editor:read")
    const text = await this.editor.getText()
    if (typeof text !== "string") throw new Error("Editor text result is invalid")
    return text
  }

  private async getSelection(_params: RpcValue): Promise<RpcValue> {
    this.requirePermission("editor:read")
    return selectionValue(await this.editor.getSelection()) as unknown as RpcValue
  }

  private async replaceSelection(params: RpcValue): Promise<RpcValue> {
    this.requirePermission("editor:write")
    const value = record(params, "Editor replacement")
    const text = boundedString(value.text, "Replacement text", 2 ** 20, true)
    await this.editor.replaceSelection(text)
    return null
  }

  private async focus(_params: RpcValue): Promise<RpcValue> {
    this.requirePermission("editor:read")
    await this.editor.focus()
    return null
  }

  private async listNotes(_params: RpcValue): Promise<RpcValue> {
    this.requirePermission("notes:read")
    const paths: string[] = []
    for (const path of await this.notes.list()) paths.push(notePath(path))
    return [...new Set(paths)]
  }

  private async readNote(params: RpcValue): Promise<RpcValue> {
    this.requirePermission("notes:read")
    const value = record(params, "Note read")
    return noteContentValue(await this.notes.read(notePath(value.path))) as unknown as RpcValue
  }

  private async createNote(params: RpcValue): Promise<RpcValue> {
    this.requirePermission("notes:write")
    const value = record(params, "Note create")
    return createResultValue(await this.notes.create(notePath(value.path)))
  }

  private async writeNote(params: RpcValue): Promise<RpcValue> {
    this.requirePermission("notes:write")
    const value = record(params, "Note write")
    const path = notePath(value.path)
    const content = boundedString(value.content, "Note content", 8 * 1024 * 1024, true)
    const mtime = expectedMtime(value.expectedLastModified)
    return saveResultValue(await this.notes.write(path, content, mtime))
  }

  private async deleteNote(params: RpcValue): Promise<RpcValue> {
    this.requirePermission("notes:write")
    const value = record(params, "Note delete")
    await this.notes.delete(notePath(value.path))
    return null
  }

  private async moveNote(params: RpcValue): Promise<RpcValue> {
    this.requirePermission("notes:write")
    const value = record(params, "Note move")
    const from = notePath(value.from)
    const to = notePath(value.to)
    return moveResultValue(await this.notes.move(from, to))
  }

  private async getActiveNote(params: RpcValue): Promise<RpcValue> {
    this.requirePermission("navigation:read")
    if (params !== null) throw new Error("navigation.getActiveNote expects null")
    return activeNoteValue(await this.requireNavigation().getActiveNote()) as unknown as RpcValue
  }

  private async openNote(params: RpcValue): Promise<RpcValue> {
    this.requirePermission("navigation:write")
    const value = record(params, "Open note")
    const path = notePath(value.path)
    const options = openNoteOptions(value.options)
    return openNoteResultValue(await this.requireNavigation().openNote(path, options)) as unknown as RpcValue
  }

  private async resolveLink(params: RpcValue): Promise<RpcValue> {
    this.requirePermission("navigation:read")
    const value = record(params, "Resolve link")
    const target = boundedString(value.target, "Link target", MAX_NAVIGATION_TARGET_LENGTH, true)
    const options = resolveLinkOptions(value.options)
    return linkResolutionValue(await this.requireNavigation().resolveLink(target, options)) as unknown as RpcValue
  }

  private requireNavigation(): ExtensionNavigationCapabilities {
    if (!this.navigation) throw new Error("Extension navigation capability is unavailable")
    return this.navigation
  }

  private notifyActionsChanged(): void {
    if (!this.onActionsChanged) return
    try {
      this.onActionsChanged()
    } catch (error) {
      this.reportError(error)
    }
  }

  private reportError(error: unknown): void {
    if (!this.onError) return
    try {
      this.onError(error)
    } catch {
      // An observer must not turn a failed extension call into a host failure.
    }
  }

  private requirePermission(permission: ScriptPermission): void {
    if (!this.permissions.has(permission)) {
      throw new Error(`Extension permission is not granted: ${permission}`)
    }
  }
}
