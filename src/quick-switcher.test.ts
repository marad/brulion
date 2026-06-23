import { describe, it, expect, vi, beforeEach } from "vitest"
import { mountQuickSwitcher } from "./quick-switcher"
import type { QuickSwitcherDeps, QuickSwitcherElements } from "./quick-switcher"

// DOM contract (from docs/excavation/quick-switcher/01-architecture.md):
//   - rows are buttons with class "switch-row"; the highlighted one also has "active".
//   - the create row is a button with class "switch-create" whose text contains the
//     displayName of the query.
//   - backdrop visibility is driven by the [hidden] attribute.
//   - the error line is shown (not [hidden]) only after a failed create.
// DOM details not pinned by the doc and chosen here for the implementer to follow:
//   - keyboard events (ArrowDown/Enter/Escape) are dispatched on the input element.
//   - a row's note path is observed only via the callback argument, never a field.

function elements(): QuickSwitcherElements {
  const backdrop = document.createElement("div")
  const input = document.createElement("input")
  const list = document.createElement("div")
  const error = document.createElement("div")
  // Initial hidden state (the host markup ships them hidden).
  backdrop.hidden = true
  error.hidden = true
  document.body.append(backdrop, input, list, error)
  return { backdrop, input, list, error }
}

const NOTES = ["start.md", "projects/diablo.md", "ideas.md"]

function deps(over: Partial<QuickSwitcherDeps> = {}): QuickSwitcherDeps {
  return {
    getNotes: () => NOTES,
    getRecency: () => [],
    getActiveNote: () => "",
    openNote: vi.fn(),
    createNote: vi.fn().mockResolvedValue({ ok: true }),
    ...over,
  }
}

const rows = (els: QuickSwitcherElements) =>
  [...els.list.querySelectorAll<HTMLElement>(".switch-row")]
const activeRow = (els: QuickSwitcherElements) =>
  els.list.querySelector<HTMLElement>(".switch-row.active")
const createRow = (els: QuickSwitcherElements) =>
  els.list.querySelector<HTMLElement>(".switch-create")

function type(els: QuickSwitcherElements, value: string) {
  els.input.value = value
  els.input.dispatchEvent(new Event("input", { bubbles: true }))
}
function key(els: QuickSwitcherElements, k: string) {
  els.input.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }))
}

beforeEach(() => {
  document.body.innerHTML = ""
})

describe("mountQuickSwitcher open/render (FEAT-0033 AC-2)", () => {
  it("open() shows the backdrop, focuses the input, renders one row per note", () => {
    const els = elements()
    const sw = mountQuickSwitcher(els, deps())

    sw.open()

    expect(els.backdrop.hidden).toBe(false)
    expect(document.activeElement).toBe(els.input)
    expect(sw.isOpen()).toBe(true)
    expect(rows(els)).toHaveLength(NOTES.length)
  })

  it("highlights the first row by default", () => {
    const els = elements()
    const sw = mountQuickSwitcher(els, deps())
    sw.open()

    const all = rows(els)
    expect(activeRow(els)).toBe(all[0])
  })

  it("orders the empty-query list by recency, most-recent first (FEAT-0039)", () => {
    const els = elements()
    // start.md most-recently visited, then ideas.md; projects/diablo.md never.
    const sw = mountQuickSwitcher(els, deps({ getRecency: () => ["start.md", "ideas.md"] }))
    sw.open()

    const labels = rows(els).map((r) => r.textContent)
    expect(labels).toEqual(["start", "ideas", "projects/diablo"])
  })

  it("excludes the currently-open note from the list (FEAT-0039 AC-8)", () => {
    const els = elements()
    // ideas.md is open; the empty switcher must omit it and start at the next note.
    const sw = mountQuickSwitcher(
      els,
      deps({ getActiveNote: () => "ideas.md", getRecency: () => ["ideas.md", "start.md"] }),
    )
    sw.open()

    const labels = rows(els).map((r) => r.textContent)
    expect(labels).not.toContain("ideas")
    expect(labels).toEqual(["start", "projects/diablo"]) // ideas excluded; start is most-recent
  })

  it("typing filters the rendered rows", () => {
    const els = elements()
    const sw = mountQuickSwitcher(els, deps())
    sw.open()
    expect(rows(els)).toHaveLength(3)

    type(els, "diablo")

    const remaining = rows(els)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].textContent).toContain("diablo")
  })
})

describe("mountQuickSwitcher activation (FEAT-0033 AC-2)", () => {
  it("ArrowDown then Enter opens the highlighted note's path and closes", () => {
    const els = elements()
    const d = deps()
    const sw = mountQuickSwitcher(els, d)
    sw.open()

    // matches order = name (path asc): ideas.md, projects/diablo.md, start.md.
    // Default highlight is the first row; ArrowDown moves to the second.
    key(els, "ArrowDown")
    key(els, "Enter")

    expect(d.openNote).toHaveBeenCalledWith("projects/diablo.md")
    expect(els.backdrop.hidden).toBe(true)
    expect(sw.isOpen()).toBe(false)
  })

  it("clicking a row opens that note's path and closes", () => {
    const els = elements()
    const d = deps()
    const sw = mountQuickSwitcher(els, d)
    sw.open()

    // First row is ideas.md (name order).
    rows(els)[0].click()

    expect(d.openNote).toHaveBeenCalledWith("ideas.md")
    expect(sw.isOpen()).toBe(false)
  })
})

describe("mountQuickSwitcher create (FEAT-0033 AC-2)", () => {
  it("a no-match query renders a create row with the query's displayName", () => {
    const els = elements()
    const sw = mountQuickSwitcher(els, deps())
    sw.open()

    type(els, "brand new note")

    expect(rows(els)).toHaveLength(0)
    const create = createRow(els)
    expect(create).not.toBeNull()
    expect(create!.textContent).toContain("brand new note")
  })

  it("Enter on the create row calls createNote with the trimmed query; closes on ok", async () => {
    const els = elements()
    const create = vi.fn().mockResolvedValue({ ok: true })
    const sw = mountQuickSwitcher(els, deps({ createNote: create }))
    sw.open()

    type(els, "  brand new note  ")
    key(els, "Enter") // only row present is the create row → it is highlighted

    expect(create).toHaveBeenCalledWith("brand new note")
    await vi.waitFor(() => expect(sw.isOpen()).toBe(false))
    expect(els.backdrop.hidden).toBe(true)
  })

  it("when createNote resolves {ok:false, reason} the error shows and the overlay stays open", async () => {
    const els = elements()
    const create = vi.fn().mockResolvedValue({ ok: false, reason: "Name cannot be empty." })
    const sw = mountQuickSwitcher(els, deps({ createNote: create }))
    sw.open()

    type(els, "bad name")
    key(els, "Enter")

    await vi.waitFor(() => {
      expect(els.error.hidden).toBe(false)
      expect(els.error.textContent).toContain("Name cannot be empty.")
    })
    expect(sw.isOpen()).toBe(true)
  })
})

describe("mountQuickSwitcher close/teardown (FEAT-0033 AC-2)", () => {
  it("Esc closes without calling openNote or createNote", () => {
    const els = elements()
    const d = deps()
    const sw = mountQuickSwitcher(els, d)
    sw.open()

    key(els, "Escape")

    expect(sw.isOpen()).toBe(false)
    expect(els.backdrop.hidden).toBe(true)
    expect(d.openNote).not.toHaveBeenCalled()
    expect(d.createNote).not.toHaveBeenCalled()
  })

  it("close() hides the overlay and reports not open", () => {
    const els = elements()
    const sw = mountQuickSwitcher(els, deps())
    sw.open()
    expect(sw.isOpen()).toBe(true)

    sw.close()

    expect(sw.isOpen()).toBe(false)
    expect(els.backdrop.hidden).toBe(true)
  })

  it("destroy() does not throw and leaves the switcher closed", () => {
    const els = elements()
    const sw = mountQuickSwitcher(els, deps())
    sw.open()

    expect(() => sw.destroy()).not.toThrow()
    expect(sw.isOpen()).toBe(false)
  })
})
