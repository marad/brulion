/**
 * A small positioned popup menu — the shared shape behind both the editor's
 * right-click formatting menu (`context-menu.ts`, FEAT-0009) and the sidebar
 * tree's row context menu (`tree-menu.ts`, M35/FEAT-0071): built at `(x, y)`,
 * clamped into the viewport, dismissed by picking an item, Escape, or an
 * outside pointerdown. Only one such menu is ever open at a time — opening a
 * new one closes whatever was already showing, editor or tree alike.
 */

/** One selectable action in a positioned menu. */
export interface PositionedMenuItem {
  label: string
  onPick: () => void
}

/** The single open menu and the teardown that removes it + its listeners. */
let close: (() => void) | null = null

/** Close whatever positioned menu is open. A no-op if none is. */
export function closePositionedMenu(): void {
  close?.()
  close = null
}

/** Options for {@link openPositionedMenu}. */
export interface PositionedMenuOptions {
  /** Runs when Escape or Tab closes the menu — never on an item pick or an
   * outside click — for a caller that needs to reclaim focus specifically on
   * that path (the editor returns to the view; the tree returns to the row it
   * was opened from). */
  onDismiss?: () => void
  /** Move focus onto the first item when the menu opens, making it operable by
   * arrows/Enter without a pointer. Set only for a keyboard-invoked open (the
   * tree's Shift+F10 path, M35/FEAT-0071/AC-8); a pointer-opened menu leaves
   * focus where it was so it doesn't steal the caret from the editor. */
  focusFirstItem?: boolean
}

/**
 * Open a menu at `(x, y)` listing `items`; does nothing for an empty list.
 * See {@link PositionedMenuOptions} for the dismiss hook and keyboard-focus
 * behavior. Arrow/Enter/Space navigation is active only while focus is inside
 * the menu, so a pointer-opened menu that left focus in the editor never
 * hijacks the caret's arrow keys.
 */
export function openPositionedMenu(
  x: number,
  y: number,
  items: PositionedMenuItem[],
  opts: PositionedMenuOptions = {},
): void {
  closePositionedMenu()
  if (items.length === 0) return

  const menu = document.createElement("div")
  menu.className = "cm-context-menu"
  menu.setAttribute("role", "menu")

  const buttons: HTMLButtonElement[] = []
  for (const item of items) {
    const button = document.createElement("button")
    button.type = "button"
    button.setAttribute("role", "menuitem")
    button.textContent = item.label
    // mousedown would blur/collapse whatever selection the caller cares about
    // before the click handler runs; prevent it so that survives until we act.
    button.addEventListener("mousedown", (e) => e.preventDefault())
    button.addEventListener("click", () => {
      closePositionedMenu()
      item.onPick()
    })
    menu.appendChild(button)
    buttons.push(button)
  }

  menu.style.left = `${x}px`
  menu.style.top = `${y}px`
  document.body.appendChild(menu)

  // Clamp into the viewport so a right-click/long-press near the bottom/right
  // edge doesn't push items off-screen.
  const rect = menu.getBoundingClientRect()
  if (rect.right > window.innerWidth) {
    menu.style.left = `${Math.max(0, window.innerWidth - rect.width)}px`
  }
  if (rect.bottom > window.innerHeight) {
    menu.style.top = `${Math.max(0, window.innerHeight - rect.height)}px`
  }

  // Roving focus among the items; wraps at both ends (standard menu behavior).
  const focusItem = (i: number) => {
    const n = buttons.length
    buttons[((i % n) + n) % n]?.focus()
  }

  const dismiss = () => {
    closePositionedMenu()
    opts.onDismiss?.()
  }

  const onPointerDown = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) closePositionedMenu()
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      dismiss()
      return
    }
    // Every key below is menu navigation — handle it only while focus is
    // actually inside the menu. A pointer-opened menu (e.g. the editor's) that
    // left focus in the editor must let arrows/Enter reach the editor instead.
    if (!menu.contains(document.activeElement)) return
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        focusItem(current + 1)
        break
      case "ArrowUp":
        e.preventDefault()
        focusItem(current - 1)
        break
      case "Home":
        e.preventDefault()
        focusItem(0)
        break
      case "End":
        e.preventDefault()
        focusItem(buttons.length - 1)
        break
      case "Enter":
      case " ":
        e.preventDefault()
        buttons[current]?.click()
        break
      case "Tab":
        // Trap Tab: a menu appended at <body> end has nowhere sensible to Tab
        // to, so close and hand focus back to the opener instead of stranding it.
        e.preventDefault()
        dismiss()
        break
    }
  }
  // `true` (capture) so an outside click closes us before it does anything else.
  document.addEventListener("pointerdown", onPointerDown, true)
  document.addEventListener("keydown", onKeyDown, true)

  close = () => {
    document.removeEventListener("pointerdown", onPointerDown, true)
    document.removeEventListener("keydown", onKeyDown, true)
    menu.remove()
  }

  if (opts.focusFirstItem) buttons[0]?.focus()
}
