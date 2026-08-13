export type ExtensionIconName = string

export interface BrulionCommand {
  id: string
  label: string
  description?: string
  icon?: ExtensionIconName
}

/** A user-invoked command callback. Its return value is ignored. */
export type CommandHandler = () => void | Promise<void>

export interface RegisterResult {
  actionId: string
}

/** The primary active editor selection, using zero-based document offsets. */
export interface EditorSelection {
  anchor: number
  head: number
  text: string
}

/** Note bytes and the mtime used for a subsequent guarded write. */
export interface EditorSelectionRequest {
  anchor: number
  head: number
}

export interface MessagePart {
  type: "text" | "strong" | "code"
  text: string
}

export type MessageContent = string | readonly MessagePart[]

export interface NotificationOptions { level?: "info" | "success" | "warning" | "error" }
export interface AlertOptions { okLabel: string }
export interface ConfirmOptions { confirmLabel: string; cancelLabel: string }
export interface PromptOptions {
  confirmLabel: string
  cancelLabel: string
  initial?: string
  placeholder?: string
  multiline?: boolean
}

export interface NoteContent {
  content: string
  lastModified: number | null
}

export type CreateResult =
  | { status: "created" }
  | { status: "exists" }

export type SaveResult =
  | { status: "saved"; lastModified: number }
  | { status: "conflict" }

export type MoveResult =
  | { status: "moved" }
  | { status: "exists" }
  | { status: "missing" }

export interface ActiveNote {
  path: string
}

export interface OpenNoteOptions {
  anchor?: string
}

export type AnchorStatus = "not-requested" | "found" | "not-found"

export type OpenNoteResult =
  | {
      status: "opened" | "already-open"
      path: string
      anchor: string | null
      anchorStatus: AnchorStatus
    }
  | { status: "missing"; path: string; anchor: string | null }
  | { status: "conflict"; path: string }

export type LinkKind = "markdown" | "wikilink"

export interface ResolveLinkOptions {
  from?: string
  kind: LinkKind
}

export type LinkResolution =
  | { status: "resolved"; path: string; anchor: string | null }
  | { status: "missing"; path: string; anchor: string | null }
  | { status: "external"; target: string }
  | { status: "invalid"; target: string }

export interface BrulionApi {
  commands: {
    register(
      command: BrulionCommand,
      run: CommandHandler,
    ): Promise<RegisterResult>
    unregister(id: string): Promise<void>
  }
  editor: {
    getText(): Promise<string>
    getSelection(): Promise<EditorSelection>
    setSelection(selection: EditorSelectionRequest): Promise<void>
    replaceSelection(text: string): Promise<void>
    focus(): Promise<void>
  }
  notifications: {
    show(message: MessageContent, options?: NotificationOptions): Promise<void>
  }
  dialogs: {
    alert(message: MessageContent, options: AlertOptions): Promise<void>
    confirm(message: MessageContent, options: ConfirmOptions): Promise<boolean>
    prompt(message: MessageContent, options: PromptOptions): Promise<string | null>
  }
  notes: {
    /** Folder-relative POSIX paths of all .md notes, sorted case-insensitively. */
    list(): Promise<readonly string[]>
    /** A missing note returns empty content with lastModified: null. */
    read(path: string): Promise<NoteContent>
    /** Creates an empty note and never replaces existing bytes. */
    create(path: string): Promise<CreateResult>
    /** Pass read().lastModified to avoid overwriting an external edit. */
    write(
      path: string,
      content: string,
      expectedLastModified: number | null,
    ): Promise<SaveResult>
    /** Idempotent deletion; an absent note is not an error. */
    delete(path: string): Promise<void>
    /** Moves bytes without replacing an occupied destination. */
    move(from: string, to: string): Promise<MoveResult>
  }
  navigation: {
    /** Returns the canonical active note path, or null when no note is active. */
    getActiveNote(): Promise<ActiveNote | null>
    /** Opens an existing note; missing targets are never created. */
    openNote(path: string, options?: OpenNoteOptions): Promise<OpenNoteResult>
    /** Resolves one raw markdown or wikilink destination without side effects. */
    resolveLink(target: string, options: ResolveLinkOptions): Promise<LinkResolution>
  }
}

declare global {
  const brulion: BrulionApi
}
