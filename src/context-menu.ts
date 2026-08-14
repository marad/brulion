import { EditorView, ViewPlugin } from "@codemirror/view"
import { type Extension } from "@codemirror/state"
import { type MenuItem } from "./format-actions"
import { linkContext } from "./markdown-render"
import { computeWikilinkToggle } from "./wikilink"
import { editRichLink } from "./rich-markdown"
import {
  dispatchRichDocumentChange,
  hasRichEditor,
  richDocumentFromState,
  richEditorPositionToModel,
} from "./rich-editor"
import { openPositionedMenu, closePositionedMenu } from "./positioned-menu"

/**
 * The right-click menu (FEAT-0009), reduced in M17 P3 (FEAT-0053) to its one
 * position-based item: the **wikilink-form toggle**. Formatting moved to the
 * selection toolbar (FEAT-0052/FEAT-0053). The same toggle is adapted to the
 * rich source map for the primary editor; raw secondary editors retain the
 * original syntax-tree-free text path.
 */

type ContextItem = { label: string; run: (view: EditorView) => boolean }

function rawToggleItem(view: EditorView, x: number, y: number): ContextItem | null {
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
    run: (current) => {
      const item: MenuItem = {
        label: toggle.label,
        run: () => ({ changes: { from: toggle.from, to: toggle.to, insert: toggle.insert } }),
      }
      const spec = item.run(current.state)
      if (!spec) return false
      current.dispatch(spec)
      return true
    },
  }
}

function richToggleItem(view: EditorView, x: number, y: number): ContextItem | null {
  const position = view.posAtCoords({ x, y })
  const document = richDocumentFromState(view.state)
  if (position == null || !document) return null
  const modelPosition = richEditorPositionToModel(document, position)
  const link = document.links.find((candidate) =>
    candidate.kind === "wikilink" && modelPosition >= candidate.labelFrom && modelPosition <= candidate.labelTo,
  )
  if (!link) return null
  const toggle = computeWikilinkToggle(document.source, link.targetFrom, view.state.facet(linkContext).notePaths)
  if (!toggle) return null
  return {
    label: toggle.label,
    run: (current) => {
      const currentDocument = richDocumentFromState(current.state)
      if (!currentDocument) return false
      const currentLink = currentDocument.links.find((candidate) =>
        candidate.kind === "wikilink" && candidate.sourceFrom === link.sourceFrom && candidate.sourceTo === link.sourceTo,
      )
      if (!currentLink) return false
      const next = editRichLink(currentDocument, currentLink, { target: toggle.insert })
      if (!next) return false
      const selection = current.state.selection.main
      const mapped = {
        anchor: richEditorPositionToModel(currentDocument, selection.anchor),
        head: richEditorPositionToModel(currentDocument, selection.head),
      }
      dispatchRichDocumentChange(current, next, mapped, "input.link")
      return true
    },
  }
}

/** The wikilink-form toggle item for a right-click at `(x, y)`, when applicable. */
function toggleItemFor(view: EditorView, x: number, y: number): ContextItem | null {
  return hasRichEditor(view.state) ? richToggleItem(view, x, y) : rawToggleItem(view, x, y)
}

function openMenu(view: EditorView, x: number, y: number, items: ContextItem[]) {
  openPositionedMenu(
    x,
    y,
    items.map((item) => ({
      label: item.label,
      onPick: () => {
        item.run(view)
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
// down when the view is destroyed (e.g. unmount / HMR) — otherwise the orphaned
// node and its document listeners would leak and reference a dead view.
const contextMenuCleanup = ViewPlugin.define(() => ({ destroy: closePositionedMenu }))

/** The right-click wikilink-form menu extension. */
export const contextMenu: Extension = [contextMenuHandler, contextMenuCleanup]
