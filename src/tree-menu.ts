import { openPositionedMenu, closePositionedMenu } from "./positioned-menu"

/**
 * The sidebar tree's row context menu (M35/FEAT-0071), reachable by
 * right-click, long-press, and the keyboard context-menu shortcut. A thin
 * wrapper over the shared `positioned-menu.ts` primitive it also shares with
 * the editor's `context-menu.ts` — the tree has no `EditorView` state to
 * dispatch into, just a plain callback per item.
 */

/** One selectable action in the tree's context menu. */
export interface TreeMenuItem {
  label: string
  run: () => void
}

/** How a tree menu was invoked, controlling its keyboard behavior (AC-8). */
export interface TreeMenuOpenOptions {
  /** Focus the first item on open and return focus to the opener when Escape/
   * Tab closes the menu — set only for a keyboard-invoked open, so a keyboard
   * user can drive the menu and lands back on their row afterward. */
  fromKeyboard?: boolean
  /** Where to send focus when a keyboard-opened menu is dismissed (the row it
   * was opened from). */
  onDismiss?: () => void
}

/** Close whatever tree menu is open. A no-op if none is. */
export function closeTreeMenu(): void {
  closePositionedMenu()
}

/** Open a menu at `(x, y)` listing `items`; does nothing for an empty list.
 * Replaces an already-open menu rather than stacking a second one. Dismissed
 * by picking an item, Escape, or a pointerdown outside it. A keyboard-invoked
 * open (`fromKeyboard`) additionally takes focus and is arrow-navigable
 * (M35/FEAT-0071/AC-8). */
export function openTreeMenu(
  x: number,
  y: number,
  items: TreeMenuItem[],
  opts: TreeMenuOpenOptions = {},
): void {
  openPositionedMenu(
    x,
    y,
    items.map((item) => ({ label: item.label, onPick: item.run })),
    { focusFirstItem: opts.fromKeyboard, onDismiss: opts.onDismiss },
  )
}
