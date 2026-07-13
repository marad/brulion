/** The result of a move attempt, mirroring the note controller's `AddNoteResult`. */
export interface MovePickerResult {
  ok: boolean
  reason?: string
}

/** The DOM nodes the picker drives (all pre-existing, initially hidden). */
export interface MovePickerElements {
  /** The full-screen backdrop; toggled via `[hidden]`, click-to-close. */
  backdrop: HTMLElement
  /** The filter input. */
  input: HTMLInputElement
  /** The results container (rebuilt each render). */
  list: HTMLElement
  /** Inline message line for a failed move; hidden when empty. */
  error: HTMLElement
}

/** Handle returned to the host. */
export interface MovePicker {
  /**
   * Show the overlay listing `folders` as destinations (root represented by
   * `""`, labeled "(root)") — freshly bound to `onPick` for this open, so the
   * caller can close over whatever note/folder is being moved without this
   * module knowing anything about notes or folders itself.
   */
  open(folders: readonly string[], onPick: (destination: string) => Promise<MovePickerResult>): void
  /** Hide the overlay without picking anything. */
  close(): void
  isOpen(): boolean
  /** Detach event listeners (for teardown/tests). */
  destroy(): void
}

/** The picker's label for a destination path — root reads as "(root)". */
function label(path: string): string {
  return path === "" ? "(root)" : path
}

/**
 * Mount the "Move to…" destination picker (M35/FEAT-0070) over its (hidden)
 * DOM nodes. Same shape as `mountQuickSwitcher`/`mountCommandPalette` (open/
 * close, arrow/Enter/Esc keys, row clicks, backdrop click) — a flat folder
 * list is small, so filtering here is a plain case-insensitive substring
 * match on the label rather than the fuzzy scoring the note switcher uses.
 */
export function mountMovePicker(els: MovePickerElements): MovePicker {
  const { backdrop, input, list, error } = els
  let open = false
  /** Bumped on every open/close so a slow pick that resolves after the picker
   * has closed or reopened can detect it is stale and do nothing. */
  let generation = 0
  /** The element focused before the picker opened, restored on close. */
  let restoreFocus: HTMLElement | null = null
  let onPick: (destination: string) => Promise<MovePickerResult> = () => Promise.resolve({ ok: true })
  let folders: readonly string[] = []
  let items: { el: HTMLElement; path: string }[] = []
  let highlight = 0

  function setError(message: string | null): void {
    error.textContent = message ?? ""
    error.hidden = message === null
  }

  function applyHighlight(): void {
    items.forEach((it, i) => it.el.classList.toggle("active", i === highlight))
    items[highlight]?.el.scrollIntoView({ block: "nearest" })
  }

  async function pick(path: string): Promise<void> {
    const issued = generation
    const result = await onPick(path)
    if (issued !== generation) return // closed/reopened while awaiting — stale
    if (result.ok) close()
    else setError(result.reason ?? "Could not move it there.")
  }

  function render(): void {
    const query = input.value.trim().toLowerCase()
    const matches = folders.filter((f) => label(f).toLowerCase().includes(query))
    list.replaceChildren()
    items = []
    for (const path of matches) {
      const el = document.createElement("button")
      el.type = "button"
      el.className = "move-row"
      el.textContent = label(path)
      el.addEventListener("click", () => void pick(path))
      list.append(el)
      items.push({ el, path })
    }
    highlight = 0
    applyHighlight()
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
        if (items[highlight]) void pick(items[highlight].path)
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

  function openPicker(
    newFolders: readonly string[],
    newOnPick: (destination: string) => Promise<MovePickerResult>,
  ): void {
    generation++
    open = true
    folders = newFolders
    onPick = newOnPick
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
    restoreFocus?.focus?.()
    restoreFocus = null
  }

  input.addEventListener("input", onInput)
  input.addEventListener("keydown", onKeydown)
  backdrop.addEventListener("click", onBackdropClick)

  return {
    open: openPicker,
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
