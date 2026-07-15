import { EditorView, ViewPlugin } from "@codemirror/view"
import { type Extension } from "@codemirror/state"
import { type MenuItem } from "./format-actions"
import { linkContext } from "./markdown-render"
import { computeWikilinkToggle } from "./wikilink"
import { openPositionedMenu, closePositionedMenu } from "./positioned-menu"

/**
 * The right-click menu (FEAT-0009), reduced in M17 P3 (FEAT-0053) to its one
 * position-based item: the **wikilink-form toggle**. Formatting moved to the selection
 * toolbar (FEAT-0052/FEAT-0053). So this menu opens *only* when the click lands on a
 * togglable wikilink; on plain text it does nothing and the browser's native menu is
 * left to show. Built on the shared `positioned-menu.ts` primitive it has in common
 * with the sidebar tree's context menu (M35/FEAT-0071).
 */

/** The wikilink-form toggle item for a right-click at `(x, y)`, when the click lands
 * on a wikilink that points at a nested note with a unique basename — else `null` (no
 * menu). The single item this menu still hosts (FEAT-0053). */
function toggleItemFor(view: EditorView, x: number, y: number): MenuItem | null {
  const pos = view.posAtCoords({ x, y })
  if (pos == null) return null
  const toggle = computeWikilinkToggle(
    view.state.doc.toString(),
    pos,
    view.state.facet(linkContext).notePaths,
  )
  if (!toggle) return null
  return {
    label: toggle.label,
    run: () => ({ changes: { from: toggle.from, to: toggle.to, insert: toggle.insert } }),
  }
}

function openMenu(view: EditorView, x: number, y: number, items: MenuItem[]) {
  openPositionedMenu(
    x,
    y,
    items.map((item) => ({
      label: item.label,
      onPick: () => {
        const spec = item.run(view.state)
        if (spec) view.dispatch(spec)
        view.focus()
      },
    })),
    { onDismiss: () => view.focus() }, // Escape/Tab also returns focus to the editor
  )
}

/** Opens our one-item toggle popup only when the right-click lands on a togglable
 * wikilink; otherwise falls through to the browser's native menu (FEAT-0053). */
const contextMenuHandler = EditorView.domEventHandlers({
  contextmenu(event, view) {
    const item = toggleItemFor(view, event.clientX, event.clientY)
    if (!item) return false // plain text → leave the native context menu
    event.preventDefault()
    openMenu(view, event.clientX, event.clientY, [item])
    return true
  },
})

// The menu DOM lives on document.body, outside CodeMirror's tree, so tear it
// down when the view is destroyed (e.g. unmount / HMR) — otherwise the
// orphaned node and its document listeners would leak and reference a dead view.
const contextMenuCleanup = ViewPlugin.define(() => ({ destroy: closePositionedMenu }))

/** The right-click formatting menu extension. */
export const contextMenu: Extension = [contextMenuHandler, contextMenuCleanup]
