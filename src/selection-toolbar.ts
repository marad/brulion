import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view"
import { type Extension } from "@codemirror/state"
import { FORMAT_ITEMS } from "./format-actions"

/**
 * A floating formatting toolbar over a non-empty selection (FEAT-0052) — the touch
 * counterpart to the right-click context menu. Shown only in a touch/narrow context
 * (no mouse + no keyboard chords to reach formatting otherwise); on a desktop mouse
 * at a wide viewport it never appears. Reuses {@link FORMAT_ITEMS}, so a tap produces
 * the exact same clean markdown as the menu and the `Ctrl` shortcuts.
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

/** Touch/narrow gate: a coarse pointer (touch) or the M17 narrow breakpoint. */
const TOUCH = window.matchMedia("(pointer: coarse), (max-width: 40rem)")

class SelectionToolbar {
  private el: HTMLElement | null = null

  // A plain scroll dispatches no transaction, so the plugin's update() wouldn't fire
  // and the position:fixed toolbar would detach from the (scrolling) selection. Track
  // the scroller directly to keep it anchored.
  private readonly onScroll = () => this.render()

  constructor(private readonly view: EditorView) {
    this.view.scrollDOM.addEventListener("scroll", this.onScroll)
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
    this.el?.remove()
    this.el = null
  }

  /** Show + position the toolbar for a non-empty selection in a touch/narrow
   * context with the editor focused; hide it otherwise. Positioning reads the editor
   * layout (`coordsAtPos`), which is illegal during an update — so it is deferred to
   * the measure phase via `requestMeasure`. */
  private render() {
    const sel = this.view.state.selection.main
    if (!TOUCH.matches || !this.view.hasFocus || sel.empty) {
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
    el.style.display = "flex"
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
    if (this.el) this.el.style.display = "none"
  }
}

/** The touch selection formatting toolbar extension (FEAT-0052). */
export const selectionToolbar: Extension = ViewPlugin.fromClass(SelectionToolbar)
