import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view"
import { type Extension } from "@codemirror/state"
import { FORMAT_ITEMS } from "./format-actions"

/**
 * A floating formatting toolbar over a non-empty selection — the single formatting
 * surface, on desktop and touch (FEAT-0052, unified in FEAT-0053). It appears on any
 * non-empty selection once it settles (on desktop, after a pointer drag ends, so
 * drag-selecting doesn't flicker it); a keyboard or touch-handle selection shows it
 * at once. Reuses {@link FORMAT_ITEMS}, so a tap produces the exact same clean
 * markdown as the `Ctrl` shortcuts. (The right-click menu now hosts only the
 * wikilink-form toggle — see context-menu.ts.)
 */

/** Compact button glyphs; the full action name rides on `aria-label`/`title`. */
const COMPACT: Record<string, string> = {
  Bold: "B",
  Italic: "I",
  Code: "</>",
  "Heading 1": "H1",
  "Heading 2": "H2",
  "Heading 3": "H3",
  "Clear formatting": "✕",
}

class SelectionToolbar {
  private el: HTMLElement | null = null
  // True while a pointer drag-select is in progress: the toolbar stays hidden until
  // the drag ends (pointerup), so dragging to select doesn't flicker it (FEAT-0053).
  // A keyboard or touch-handle selection sets no pointer-down here, so it shows at once.
  private dragging = false

  // A plain scroll dispatches no transaction, so the plugin's update() wouldn't fire
  // and the position:fixed toolbar would detach from the (scrolling) selection. Track
  // the scroller directly to keep it anchored.
  private readonly onScroll = () => this.render()
  private readonly onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return // only a left-button drag suppresses the toolbar
    this.dragging = true
    this.hide()
  }
  // End the drag on pointerup, but also on pointercancel and window blur — so a
  // release outside the document (over the OS chrome, another window) can't leave
  // `dragging` stuck true and the toolbar wrongly suppressed.
  private readonly endDrag = () => {
    this.dragging = false
    this.render()
  }

  constructor(private readonly view: EditorView) {
    this.view.scrollDOM.addEventListener("scroll", this.onScroll)
    this.view.contentDOM.addEventListener("pointerdown", this.onPointerDown)
    document.addEventListener("pointerup", this.endDrag)
    document.addEventListener("pointercancel", this.endDrag)
    window.addEventListener("blur", this.endDrag)
    this.render()
  }

  update(u: ViewUpdate) {
    if (
      u.selectionSet ||
      u.docChanged ||
      u.focusChanged ||
      u.viewportChanged ||
      u.geometryChanged
    ) {
      this.render()
    }
  }

  destroy() {
    this.view.scrollDOM.removeEventListener("scroll", this.onScroll)
    this.view.contentDOM.removeEventListener("pointerdown", this.onPointerDown)
    document.removeEventListener("pointerup", this.endDrag)
    document.removeEventListener("pointercancel", this.endDrag)
    window.removeEventListener("blur", this.endDrag)
    this.el?.remove()
    this.el = null
  }

  /** Show + position the toolbar for a non-empty selection with the editor focused
   * (and not mid drag-select); hide it otherwise. Positioning reads the editor layout
   * (`coordsAtPos`), which is illegal during an update — so it is deferred to the
   * measure phase via `requestMeasure`. */
  private render() {
    const sel = this.view.state.selection.main
    if (this.dragging || !this.view.hasFocus || sel.empty) {
      this.hide()
      return
    }
    if (!this.el) this.el = this.build()
    const from = sel.from
    this.view.requestMeasure({
      key: this,
      read: () => this.view.coordsAtPos(from),
      write: (coords) => this.place(coords),
    })
  }

  private build(): HTMLElement {
    const bar = document.createElement("div")
    bar.className = "cm-selection-toolbar"
    bar.hidden = true // shown by place() — toggling `hidden` lets it fade in (FEAT-0068)
    bar.setAttribute("role", "toolbar")
    bar.setAttribute("aria-label", "Format selection")
    for (const item of FORMAT_ITEMS) {
      const button = document.createElement("button")
      button.type = "button"
      button.textContent = COMPACT[item.label] ?? item.label
      button.setAttribute("aria-label", item.label)
      button.title = item.label
      // mousedown would blur the editor and collapse the selection before the click
      // handler runs; prevent it so the selection survives until we act (as the menu).
      button.addEventListener("mousedown", (e) => e.preventDefault())
      button.addEventListener("click", () => {
        const spec = item.run(this.view.state)
        if (spec) this.view.dispatch(spec) // its update() re-renders (reposition/hide)
        this.view.focus()
      })
      bar.appendChild(button)
    }
    document.body.appendChild(bar)
    return bar
  }

  /** Anchor the toolbar above the selection start, flipping below when there's no
   * room, and clamp it into the viewport. Runs in the measure phase, where reading
   * `coords` and the toolbar's own size is allowed. `coords` is null when the
   * position is scrolled out of view — hide then. */
  private place(coords: { top: number; bottom: number; left: number } | null) {
    const el = this.el
    if (!el || !coords) {
      this.hide()
      return
    }
    el.hidden = false
    el.style.visibility = "hidden" // measure the toolbar before placing it
    const rect = el.getBoundingClientRect()
    const above = coords.top - rect.height - 8
    const top = above >= 4 ? above : coords.bottom + 8
    const left = Math.max(4, Math.min(coords.left, window.innerWidth - rect.width - 4))
    el.style.left = `${left}px`
    el.style.top = `${top}px`
    el.style.visibility = "visible"
  }

  private hide() {
    if (this.el) this.el.hidden = true
  }
}

/** The selection formatting toolbar extension (FEAT-0052/FEAT-0053). */
export const selectionToolbar: Extension = ViewPlugin.fromClass(SelectionToolbar)
