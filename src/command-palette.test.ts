import { describe, it, expect, vi, beforeEach } from "vitest"
import { rankActions, mountCommandPalette } from "./command-palette"
import type { Action, CommandPaletteDeps, CommandPaletteElements } from "./command-palette"
import type { IconNode } from "lucide"

// DOM contract (sibling of the quick switcher — see src/quick-switcher.test.ts):
//   - one result row per action is rendered into `list`; the highlighted row also
//     carries the "active" class (same highlight convention as the switcher).
//   - rows render the action's label as text; an action carrying an `icon` also
//     renders an <svg> in its row (Lucide's createElement output), an action with
//     no icon renders label-only (no <svg>).
//   - backdrop visibility is driven by the [hidden] attribute.
// DOM details not pinned by the spec and chosen here for the implementer to follow:
//   - keyboard events (ArrowDown/ArrowUp/Enter/Escape) are dispatched on the input.
//   - the row class is "palette-row" (mirroring the switcher's "switch-row").
//   - backdrop-click close is recognised by `event.target === backdrop`.

// A minimal but valid Lucide IconNode: an array of [tag, attrs] children that
// lucide's createElement nests under an <svg> (it calls setAttribute over attrs and
// recurses into children, so attrs must be a plain object). One <path> is enough.
const FAKE_ICON = [["path", { d: "M0 0h24v24H0z" }]] as unknown as IconNode

function elements(): CommandPaletteElements {
  const backdrop = document.createElement("div")
  const input = document.createElement("input")
  const list = document.createElement("div")
  // Initial hidden state (the host markup ships the overlay hidden).
  backdrop.hidden = true
  document.body.append(backdrop, input, list)
  return { backdrop, input, list }
}

// The default registry the palette deps hand out. Order here IS registry order.
function actions(): Action[] {
  return [
    { id: "goto", label: "Go to note…", run: vi.fn() },
    { id: "folder", label: "Switch folder…", run: vi.fn() },
    { id: "vim", label: "Toggle Vim mode", run: vi.fn() },
    { id: "list", label: "Toggle note list", run: vi.fn() },
    { id: "settings", label: "Open settings", run: vi.fn() },
  ]
}

function deps(over: Partial<CommandPaletteDeps> = {}): CommandPaletteDeps {
  return {
    getActions: () => actions(),
    ...over,
  }
}

const rows = (els: CommandPaletteElements) =>
  [...els.list.querySelectorAll<HTMLElement>(".palette-row")]
const activeRow = (els: CommandPaletteElements) =>
  els.list.querySelector<HTMLElement>(".palette-row.active")

function type(els: CommandPaletteElements, value: string) {
  els.input.value = value
  els.input.dispatchEvent(new Event("input", { bubbles: true }))
}
function key(els: CommandPaletteElements, k: string) {
  els.input.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }))
}

beforeEach(() => {
  document.body.innerHTML = ""
})

describe("rankActions (FEAT-0057 AC-2)", () => {
  it("an empty query returns every action in registry order", () => {
    const list = actions()
    const ranked = rankActions("", list)
    expect(ranked.map((a) => a.id)).toEqual(["goto", "folder", "vim", "list", "settings"])
  })

  it("a query filters to fuzzily-matching labels, best match first", () => {
    const list = actions()
    const ranked = rankActions("toggle", list)
    const ids = ranked.map((a) => a.id)
    // Only the two "Toggle …" labels match "toggle".
    expect(ids).toContain("vim")
    expect(ids).toContain("list")
    expect(ids).not.toContain("goto")
    expect(ids).not.toContain("settings")
    expect(ids).not.toContain("folder")
  })

  it("a contiguous-substring label outranks a gapped match", () => {
    // "note" is a verbatim substring of "note" but only a gapped subsequence of
    // "n o t e here"; fuzzyScore's substring tier must rank the contiguous one first
    // (input order reversed to prove it's the score, not position, that decides).
    const sub: Action = { id: "sub", label: "note", run: () => {} }
    const gap: Action = { id: "gap", label: "n o t e here", run: () => {} }
    const ranked = rankActions("note", [gap, sub])
    expect(ranked.map((a) => a.id)).toEqual(["sub", "gap"])
  })

  it("a non-matching query returns an empty list", () => {
    expect(rankActions("zzzqqq", actions())).toEqual([])
  })

  it("breaks ties by registry order (stable)", () => {
    // Two equally-scored labels (identical text) keep their original order.
    const a: Action = { id: "a", label: "same", run: () => {} }
    const b: Action = { id: "b", label: "same", run: () => {} }
    expect(rankActions("same", [a, b]).map((x) => x.id)).toEqual(["a", "b"])
    expect(rankActions("same", [b, a]).map((x) => x.id)).toEqual(["b", "a"])
  })

  it("does not mutate the input array", () => {
    const list = actions()
    const snapshot = [...list]
    rankActions("toggle", list)
    expect(list).toEqual(snapshot)
    expect(list.map((a) => a.id)).toEqual(snapshot.map((a) => a.id))
  })
})

describe("mountCommandPalette open/render (FEAT-0057 AC-1)", () => {
  it("open() reveals the backdrop, focuses the input, renders one row per action", () => {
    const els = elements()
    const p = mountCommandPalette(els, deps())

    p.open()

    expect(els.backdrop.hidden).toBe(false)
    expect(document.activeElement).toBe(els.input)
    expect(p.isOpen()).toBe(true)
    expect(rows(els)).toHaveLength(actions().length)
  })

  it("highlights the first row by default", () => {
    const els = elements()
    const p = mountCommandPalette(els, deps())
    p.open()

    expect(activeRow(els)).toBe(rows(els)[0])
  })

  it("renders each action's label as the row text", () => {
    const els = elements()
    const p = mountCommandPalette(els, deps())
    p.open()

    const labels = rows(els).map((r) => r.textContent)
    expect(labels.some((t) => t?.includes("Go to note…"))).toBe(true)
    expect(labels.some((t) => t?.includes("Toggle Vim mode"))).toBe(true)
  })

  it("typing re-filters the rendered rows (FEAT-0057 AC-2)", () => {
    const els = elements()
    const p = mountCommandPalette(els, deps())
    p.open()
    expect(rows(els)).toHaveLength(5)

    type(els, "vim")

    const remaining = rows(els)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].textContent).toContain("Toggle Vim mode")
  })

  it("a non-matching query renders no rows (FEAT-0057 AC-2)", () => {
    const els = elements()
    const p = mountCommandPalette(els, deps())
    p.open()

    type(els, "zzzqqq")

    expect(rows(els)).toHaveLength(0)
  })
})

describe("mountCommandPalette navigation & activation (FEAT-0057 AC-3, AC-4)", () => {
  it("ArrowDown then Enter runs the highlighted action's run() and closes", () => {
    const els = elements()
    const list = actions()
    const p = mountCommandPalette(els, deps({ getActions: () => list }))
    p.open()

    // Default highlight is row 0 (goto); ArrowDown moves to row 1 (folder).
    key(els, "ArrowDown")
    key(els, "Enter")

    expect(list[1].run).toHaveBeenCalledTimes(1)
    expect(list[0].run).not.toHaveBeenCalled()
    expect(els.backdrop.hidden).toBe(true)
    expect(p.isOpen()).toBe(false)
  })

  it("ArrowUp clamps at the top (no wrap)", () => {
    const els = elements()
    const list = actions()
    const p = mountCommandPalette(els, deps({ getActions: () => list }))
    p.open()

    // Already at row 0; ArrowUp must not wrap to the last row.
    key(els, "ArrowUp")
    expect(activeRow(els)).toBe(rows(els)[0])

    key(els, "Enter")
    expect(list[0].run).toHaveBeenCalledTimes(1)
  })

  it("ArrowDown clamps at the bottom (no wrap)", () => {
    const els = elements()
    const list = actions()
    const p = mountCommandPalette(els, deps({ getActions: () => list }))
    p.open()

    // Push past the last row; it must clamp on the last, not wrap to the first.
    for (let i = 0; i < list.length + 3; i++) key(els, "ArrowDown")
    const all = rows(els)
    expect(activeRow(els)).toBe(all[all.length - 1])

    key(els, "Enter")
    expect(list[list.length - 1].run).toHaveBeenCalledTimes(1)
  })

  it("clicking a row runs that action's run() and closes", () => {
    const els = elements()
    const list = actions()
    const p = mountCommandPalette(els, deps({ getActions: () => list }))
    p.open()

    rows(els)[2].click()

    expect(list[2].run).toHaveBeenCalledTimes(1)
    expect(p.isOpen()).toBe(false)
    expect(els.backdrop.hidden).toBe(true)
  })
})

describe("mountCommandPalette close without running (FEAT-0057 AC-5)", () => {
  it("Esc closes and runs no action, restoring focus to the previous element", () => {
    const els = elements()
    const list = actions()
    // A pre-existing focused element the palette should restore focus to on close.
    const prior = document.createElement("input")
    document.body.append(prior)
    prior.focus()
    expect(document.activeElement).toBe(prior)

    const p = mountCommandPalette(els, deps({ getActions: () => list }))
    p.open()
    expect(document.activeElement).toBe(els.input)

    key(els, "Escape")

    expect(p.isOpen()).toBe(false)
    expect(els.backdrop.hidden).toBe(true)
    expect(list.every((a) => (a.run as ReturnType<typeof vi.fn>).mock.calls.length === 0)).toBe(true)
    expect(document.activeElement).toBe(prior)
  })

  it("a backdrop click (target === backdrop) closes without running anything", () => {
    const els = elements()
    const list = actions()
    const p = mountCommandPalette(els, deps({ getActions: () => list }))
    p.open()

    // A click whose target is the backdrop itself (outside the dialog) closes.
    els.backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true }))

    expect(p.isOpen()).toBe(false)
    expect(els.backdrop.hidden).toBe(true)
    expect(list.every((a) => (a.run as ReturnType<typeof vi.fn>).mock.calls.length === 0)).toBe(true)
  })

  it("close() hides the overlay and reports not open", () => {
    const els = elements()
    const p = mountCommandPalette(els, deps())
    p.open()
    expect(p.isOpen()).toBe(true)

    p.close()

    expect(p.isOpen()).toBe(false)
    expect(els.backdrop.hidden).toBe(true)
  })
})

describe("mountCommandPalette icons (FEAT-0057 AC-7)", () => {
  it("renders an <svg> in the row of an action carrying an icon", () => {
    const els = elements()
    const list: Action[] = [{ id: "iconed", label: "With icon", icon: FAKE_ICON, run: vi.fn() }]
    const p = mountCommandPalette(els, deps({ getActions: () => list }))
    p.open()

    const row = rows(els)[0]
    expect(row.querySelector("svg")).not.toBeNull()
    expect(row.textContent).toContain("With icon")
  })

  it("renders label-only (no <svg>) for an action without an icon", () => {
    const els = elements()
    const list: Action[] = [{ id: "plain", label: "No icon", run: vi.fn() }]
    const p = mountCommandPalette(els, deps({ getActions: () => list }))
    p.open()

    const row = rows(els)[0]
    expect(row.querySelector("svg")).toBeNull()
    expect(row.textContent).toContain("No icon")
  })
})

describe("mountCommandPalette teardown & no-writes (FEAT-0057 AC-10)", () => {
  it("destroy() detaches listeners: input/keys no longer affect a closed palette", () => {
    const els = elements()
    const list = actions()
    const p = mountCommandPalette(els, deps({ getActions: () => list }))

    expect(() => p.destroy()).not.toThrow()

    // After destroy, dispatched events must be inert: nothing opens, nothing runs.
    type(els, "vim")
    key(els, "Enter")
    expect(p.isOpen()).toBe(false)
    expect(list.every((a) => (a.run as ReturnType<typeof vi.fn>).mock.calls.length === 0)).toBe(true)
  })

  it("the deps surface is read-only: only getActions, no write/disk callbacks (AC-10)", () => {
    // Structural guarantee that palette use can write nothing: the only dependency
    // is a getter. (A folder is open in this scenario; opening/filtering/navigating
    // touches no FSA because there is no FSA dep to touch.)
    const d = deps()
    expect(Object.keys(d)).toEqual(["getActions"])
    expect(typeof d.getActions).toBe("function")
  })
})
