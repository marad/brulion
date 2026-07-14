import { openPositionedMenu, closePositionedMenu } from "./positioned-menu"

/**
 * The sidebar tree's row context menu (M35/FEAT-0071), reachable by
 * right-click and long-press. A thin wrapper over the shared
 * `positioned-menu.ts` primitive it also shares with the editor's
 * `context-menu.ts` — the tree has no `EditorView` state to dispatch into,
 * just a plain callback per item, so it needs none of that module's
 * `onEscape` refocus hook.
 */

/** One selectable action in the tree's context menu. */
export interface TreeMenuItem {
  label: string
  run: () => void
}

/** Close whatever tree menu is open. A no-op if none is. */
export function closeTreeMenu(): void {
  closePositionedMenu()
}

/** Open a menu at `(x, y)` listing `items`; does nothing for an empty list.
 * Replaces an already-open menu rather than stacking a second one. Dismissed
 * by picking an item, Escape, or a pointerdown outside it. */
export function openTreeMenu(x: number, y: number, items: TreeMenuItem[]): void {
  openPositionedMenu(
    x,
    y,
    items.map((item) => ({ label: item.label, onPick: item.run })),
  )
}
