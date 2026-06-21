import { displayName } from "./note-name"
import { searchNotes } from "./note-search"

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
  const { backdrop, input, list, error } = els
  let open = false
  /** Bumped on every open/close so a slow create that resolves after the user has
   * closed or reopened the switcher can detect it is stale and do nothing. */
  let generation = 0
  /** The element focused before the switcher opened, restored on close. */
  let restoreFocus: HTMLElement | null = null
  /** Each rendered, selectable row paired with the action it triggers. */
  let items: { el: HTMLElement; run: () => void }[] = []
  let highlight = 0

  function setError(message: string | null): void {
    error.textContent = message ?? ""
    error.hidden = message === null
  }

  function applyHighlight(): void {
    items.forEach((it, i) => it.el.classList.toggle("active", i === highlight))
    items[highlight]?.el.scrollIntoView({ block: "nearest" })
  }

  function row(cls: string, label: string, run: () => void): void {
    const el = document.createElement("button")
    el.type = "button"
    el.className = cls
    el.textContent = label
    el.addEventListener("click", run)
    list.append(el)
    items.push({ el, run })
  }

  function render(): void {
    const { matches, create } = searchNotes(input.value, deps.getNotes())
    list.replaceChildren()
    items = []
    for (const path of matches) {
      row("switch-row", displayName(path), () => {
        deps.openNote(path)
        close()
      })
    }
    if (create !== null) {
      row("switch-create", `Create “${displayName(create)}”`, () => {
        void create_(create)
      })
    }
    highlight = 0
    applyHighlight()
  }

  async function create_(name: string): Promise<void> {
    const issued = generation
    const result = await deps.createNote(name)
    if (issued !== generation) return // closed/reopened while awaiting — stale
    if (result.ok) close()
    else setError(result.reason ?? "Could not create note.")
  }

  function onInput(): void {
    setError(null)
    render()
  }

  function onKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault()
        highlight = Math.min(highlight + 1, items.length - 1)
        applyHighlight()
        break
      case "ArrowUp":
        event.preventDefault()
        highlight = Math.max(highlight - 1, 0)
        applyHighlight()
        break
      case "Enter":
        event.preventDefault()
        items[highlight]?.run()
        break
      case "Escape":
        event.preventDefault()
        close()
        break
    }
  }

  function onBackdropClick(event: MouseEvent): void {
    if (event.target === backdrop) close()
  }

  function openSwitcher(): void {
    if (open) {
      input.focus()
      return
    }
    generation++
    open = true
    restoreFocus = document.activeElement as HTMLElement | null
    input.value = ""
    setError(null)
    backdrop.hidden = false
    render()
    input.focus()
  }

  function close(): void {
    if (!open) return
    generation++
    open = false
    backdrop.hidden = true
    setError(null)
    // Return focus to wherever it was (e.g. the editor when opened via Ctrl+K), so
    // it doesn't get stranded on the now-hidden input.
    restoreFocus?.focus?.()
    restoreFocus = null
  }

  input.addEventListener("input", onInput)
  input.addEventListener("keydown", onKeydown)
  backdrop.addEventListener("click", onBackdropClick)

  return {
    open: openSwitcher,
    close,
    isOpen: () => open,
    destroy() {
      input.removeEventListener("input", onInput)
      input.removeEventListener("keydown", onKeydown)
      backdrop.removeEventListener("click", onBackdropClick)
      close()
    },
  }
}
