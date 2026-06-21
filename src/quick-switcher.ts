/** The result of a create attempt, mirroring the note controller's `addNote`. */
export interface CreateResult {
  ok: boolean
  reason?: string
}

/** Callbacks the switcher needs from the host; it owns none of this state. */
export interface QuickSwitcherDeps {
  /** A snapshot of the current note paths (with `.md`); read at open and per keystroke. */
  getNotes: () => readonly string[]
  /** Open an existing note by path (fire-and-forget, like the sidebar click). */
  openNote: (path: string) => void
  /** Create + open a note by name; resolves to whether it succeeded (and why not). */
  createNote: (name: string) => Promise<CreateResult>
}

/** The DOM nodes the switcher drives (all pre-existing, initially hidden). */
export interface QuickSwitcherElements {
  /** The full-screen backdrop; toggled via `[hidden]`, click-to-close. */
  backdrop: HTMLElement
  /** The search input. */
  input: HTMLInputElement
  /** The results container (rebuilt each render). */
  list: HTMLElement
  /** Inline message line for a failed create; hidden when empty. */
  error: HTMLElement
}

/** Handle returned to the host. */
export interface QuickSwitcher {
  /** Show the overlay (reset + focus). A no-op refocus if already open. */
  open(): void
  /** Hide the overlay without changing the open note. */
  close(): void
  isOpen(): boolean
  /** Detach event listeners (for teardown/tests). */
  destroy(): void
}

/**
 * Mount the quick switcher over its (hidden) DOM nodes and wire its internal
 * events (input filtering, arrow/Enter/Esc keys, row clicks, backdrop click).
 * The host adds the `Ctrl/Cmd+K` shortcut that calls `open()`.
 */
export function mountQuickSwitcher(
  els: QuickSwitcherElements,
  deps: QuickSwitcherDeps,
): QuickSwitcher {
  void els
  void deps
  throw new Error("stub")
}
