export interface BrulionCommand {
  id: string
  label: string
  description?: string
  icon?: string
}

export interface BrulionApi {
  commands: {
    register(
      command: BrulionCommand,
      run: () => unknown | Promise<unknown>,
    ): Promise<unknown>
    unregister(id: string): Promise<unknown>
  }
  editor: {
    getText(): Promise<string>
    getSelection(): Promise<{ from: number; to: number; text: string }>
    replaceSelection(text: string): Promise<unknown>
    focus(): Promise<unknown>
  }
  notes: {
    list(): Promise<readonly string[]>
    read(path: string): Promise<{ content: string; lastModified: number | null }>
  }
}

declare global {
  const brulion: BrulionApi
}
