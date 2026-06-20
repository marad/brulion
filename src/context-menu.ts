import { EditorView, ViewPlugin } from "@codemirror/view"
import { type Extension, type EditorState, type TransactionSpec } from "@codemirror/state"
import { BOLD, ITALIC, CODE, toggleInline, setHeadingLines } from "./markdown-transforms"

/**
 * Right-click formatting popup. Replaces the native context menu inside the
 * editor with a small on-demand menu (no always-visible toolbar) whose items
 * reuse the FEAT-0007 transforms, so the on-disk result is the same clean
 * markdown the shortcuts produce. Heading/clear apply per line across the whole
 * selection; bold/italic/code toggle the selection.
 */

interface MenuItem {
  label: string
  run: (state: EditorState) => TransactionSpec | null
}

const ITEMS: MenuItem[] = [
  { label: "Bold", run: (s) => toggleInline(s, BOLD) },
  { label: "Italic", run: (s) => toggleInline(s, ITALIC) },
  { label: "Code", run: (s) => toggleInline(s, CODE) },
  { label: "Heading 1", run: (s) => setHeadingLines(s, 1) },
  { label: "Heading 2", run: (s) => setHeadingLines(s, 2) },
  { label: "Heading 3", run: (s) => setHeadingLines(s, 3) },
  { label: "Clear formatting", run: (s) => setHeadingLines(s, 0) },
]

/** The single open menu and the teardown that removes it + its listeners. */
let close: (() => void) | null = null

function closeMenu() {
  close?.()
  close = null
}

function openMenu(view: EditorView, x: number, y: number) {
  closeMenu()

  const menu = document.createElement("div")
  menu.className = "cm-context-menu"
  menu.setAttribute("role", "menu")

  for (const item of ITEMS) {
    const button = document.createElement("button")
    button.type = "button"
    button.setAttribute("role", "menuitem")
    button.textContent = item.label
    // mousedown would blur the editor and collapse the selection before the
    // click handler runs; prevent it so the selection survives until we act.
    button.addEventListener("mousedown", (e) => e.preventDefault())
    button.addEventListener("click", () => {
      const spec = item.run(view.state)
      if (spec) view.dispatch(spec)
      closeMenu()
      view.focus()
    })
    menu.appendChild(button)
  }

  menu.style.left = `${x}px`
  menu.style.top = `${y}px`
  document.body.appendChild(menu)

  // Clamp into the viewport so a right-click near the bottom/right edge doesn't
  // push items off-screen.
  const rect = menu.getBoundingClientRect()
  if (rect.right > window.innerWidth) {
    menu.style.left = `${Math.max(0, window.innerWidth - rect.width)}px`
  }
  if (rect.bottom > window.innerHeight) {
    menu.style.top = `${Math.max(0, window.innerHeight - rect.height)}px`
  }

  const onPointerDown = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) closeMenu()
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      closeMenu()
      view.focus()
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

/** Opens our popup on right-click instead of the browser's native menu. */
const contextMenuHandler = EditorView.domEventHandlers({
  contextmenu(event, view) {
    event.preventDefault()
    openMenu(view, event.clientX, event.clientY)
    return true
  },
})

// `close` and the menu DOM live on document.body, outside CodeMirror's tree, so
// tear them down when the view is destroyed (e.g. unmount / HMR) — otherwise the
// orphaned node and its document listeners would leak and reference a dead view.
const contextMenuCleanup = ViewPlugin.define(() => ({ destroy: closeMenu }))

/** The right-click formatting menu extension. */
export const contextMenu: Extension = [contextMenuHandler, contextMenuCleanup]
