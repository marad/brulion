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

/**
 * Open a menu at `(x, y)` listing `items`; does nothing for an empty list.
 * `onEscape`, if given, runs only when Escape closes the menu — never on an
 * item pick or an outside click — for a caller that needs to reclaim focus
 * specifically on that path (the editor does; the tree doesn't).
 */
export function openPositionedMenu(
  x: number,
  y: number,
  items: PositionedMenuItem[],
  onEscape?: () => void,
): void {
  closePositionedMenu()
  if (items.length === 0) return

  const menu = document.createElement("div")
  menu.className = "cm-context-menu"
  menu.setAttribute("role", "menu")

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

  const onPointerDown = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) closePositionedMenu()
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      closePositionedMenu()
      onEscape?.()
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
}
