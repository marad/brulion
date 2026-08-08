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
  from: number
  to: number
  text: string
}

/** Note bytes and the mtime used for a subsequent guarded write. */
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
    replaceSelection(text: string): Promise<void>
    focus(): Promise<void>
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
}

declare global {
  const brulion: BrulionApi
}
