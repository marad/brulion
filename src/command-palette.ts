import { createElement } from "lucide"
import { fuzzyScore } from "./note-search"
import type { Action } from "./actions"

/** Callbacks the palette needs from the host; it owns no action state. */
export interface CommandPaletteDeps {
  /** A snapshot of the registered actions; read at open and per keystroke. */
  getActions: () => readonly Action[]
}

/** The DOM nodes the palette drives (all pre-existing, initially hidden). */
export interface CommandPaletteElements {
  /** The full-screen backdrop; toggled via `[hidden]`, click-to-close. */
  backdrop: HTMLElement
  /** The search input. */
  input: HTMLInputElement
  /** The results container (rebuilt each render). */
  list: HTMLElement
}

/** Handle returned to the host. */
export interface CommandPalette {
  /** Show the overlay (reset + focus). A no-op refocus if already open. */
  open(): void
  /** Hide the overlay without running anything. */
  close(): void
  isOpen(): boolean
  /** Detach event listeners (for teardown/tests). */
  destroy(): void
}

/**
 * Rank `actions` by a fuzzy match of `query` against each action's label
 * (FEAT-0038's {@link fuzzyScore}): best score first, ties broken by the action's
 * original registry order (stable). An empty query returns every action in registry
 * order (every score is 0, so the index tiebreak orders them); a query matching no
 * label returns `[]`. Pure & total — never throws, never mutates the input.
 */
export function rankActions(query: string, actions: readonly Action[]): Action[] {
  return actions
    .map((action, index) => ({ action, index, score: fuzzyScore(query, action.label) }))
    .filter((m): m is { action: Action; index: number; score: number } => m.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((m) => m.action)
}

/**
 * Mount the command palette over its (hidden) DOM nodes and wire its internal events
 * (input filtering, arrow/Enter/Esc keys, row clicks, backdrop click). The host adds
 * the `Ctrl/Cmd+Shift+K` shortcut that calls `open()`. Running an action closes the
 * overlay first, then invokes its `run()`.
 */
export function mountCommandPalette(
  els: CommandPaletteElements,
  deps: CommandPaletteDeps,
): CommandPalette {
  const { backdrop, input, list } = els
  let open = false
  /** The element focused before the palette opened, restored on close. */
  let restoreFocus: HTMLElement | null = null
  /** Each rendered, selectable row paired with the action it triggers. */
  let items: { el: HTMLElement; run: () => void }[] = []
  let highlight = 0

  function applyHighlight(): void {
    items.forEach((it, i) => it.el.classList.toggle("active", i === highlight))
    items[highlight]?.el.scrollIntoView({ block: "nearest" })
  }

  function row(action: Action): void {
    const el = document.createElement("button")
    el.type = "button"
    el.className = "palette-row"
    if (action.icon) {
      el.append(createElement(action.icon, { class: "palette-icon", "aria-hidden": "true" }))
    }
    const label = document.createElement("span")
    label.className = "palette-label"
    label.textContent = action.label
    el.append(label)
    // Run closes first, then invokes the action — so it sees focus already restored
    // (e.g. "Go to note…" opens the switcher into a clean focus state).
    const run = () => {
      close()
      action.run()
    }
    el.addEventListener("click", run)
    list.append(el)
    items.push({ el, run })
  }

  function render(): void {
    list.replaceChildren()
    items = []
    for (const action of rankActions(input.value, deps.getActions())) row(action)
    highlight = 0
    applyHighlight()
  }

  function onInput(): void {
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

  function openPalette(): void {
    if (open) {
      input.focus()
      return
    }
    open = true
    restoreFocus = document.activeElement as HTMLElement | null
    input.value = ""
    backdrop.hidden = false
    render()
    input.focus()
  }

  function close(): void {
    if (!open) return
    open = false
    backdrop.hidden = true
    // Return focus to wherever it was (e.g. the editor when opened via the shortcut),
    // so it isn't stranded on the now-hidden input.
    restoreFocus?.focus?.()
    restoreFocus = null
  }

  input.addEventListener("input", onInput)
  input.addEventListener("keydown", onKeydown)
  backdrop.addEventListener("click", onBackdropClick)

  return {
    open: openPalette,
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
