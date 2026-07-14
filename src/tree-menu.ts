/**
 * A small positioned context menu for the sidebar tree (M35/FEAT-0071),
 * reachable by right-click and long-press. Same shape as the editor's
 * `context-menu.ts` (position/clamp/dismiss semantics, and the shared
 * `.cm-context-menu` look), stripped of its `EditorView` coupling — the tree
 * has no CodeMirror state to dispatch into, just a plain callback per item.
 */

/** One selectable action in the tree's context menu. */
export interface TreeMenuItem {
  label: string
  run: () => void
}

/** The single open menu and the teardown that removes it + its listeners. */
let close: (() => void) | null = null

/** Close whatever tree menu is open. A no-op if none is. */
export function closeTreeMenu(): void {
  close?.()
  close = null
}

/** Open a menu at `(x, y)` listing `items`; does nothing for an empty list.
 * Replaces an already-open menu rather than stacking a second one. Dismissed
 * by picking an item, Escape, or a pointerdown outside it. */
export function openTreeMenu(x: number, y: number, items: TreeMenuItem[]): void {
  closeTreeMenu()
  if (items.length === 0) return

  const menu = document.createElement("div")
  menu.className = "cm-context-menu"
  menu.setAttribute("role", "menu")

  for (const item of items) {
    const button = document.createElement("button")
    button.type = "button"
    button.setAttribute("role", "menuitem")
    button.textContent = item.label
    button.addEventListener("click", () => {
      closeTreeMenu()
      item.run()
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
    if (!menu.contains(e.target as Node)) closeTreeMenu()
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") closeTreeMenu()
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
