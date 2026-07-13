import { describe, it, expect, vi, beforeEach } from "vitest"
import { mountMovePicker } from "./move-picker"
import type { MovePickerElements } from "./move-picker"

function elements(): MovePickerElements {
  const backdrop = document.createElement("div")
  const input = document.createElement("input")
  const list = document.createElement("div")
  const error = document.createElement("div")
  backdrop.hidden = true
  error.hidden = true
  document.body.append(backdrop, input, list, error)
  return { backdrop, input, list, error }
}

const FOLDERS = ["", "projects", "projects/ideas"]

const rows = (els: MovePickerElements) => [...els.list.querySelectorAll<HTMLElement>(".move-row")]
const activeRow = (els: MovePickerElements) => els.list.querySelector<HTMLElement>(".move-row.active")

function type(els: MovePickerElements, value: string) {
  els.input.value = value
  els.input.dispatchEvent(new Event("input", { bubbles: true }))
}
function key(els: MovePickerElements, k: string) {
  els.input.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }))
}

beforeEach(() => {
  document.body.innerHTML = ""
})

describe("mountMovePicker open/render (FEAT-0070)", () => {
  it("open() shows the backdrop, focuses the input, renders one row per destination", () => {
    const els = elements()
    const picker = mountMovePicker(els)

    picker.open(FOLDERS, vi.fn())

    expect(els.backdrop.hidden).toBe(false)
    expect(document.activeElement).toBe(els.input)
    expect(picker.isOpen()).toBe(true)
    expect(rows(els)).toHaveLength(FOLDERS.length)
  })

  it("labels the root destination as (root)", () => {
    const els = elements()
    const picker = mountMovePicker(els)
    picker.open(FOLDERS, vi.fn())

    expect(rows(els).map((r) => r.textContent)).toEqual(["(root)", "projects", "projects/ideas"])
  })

  it("highlights the first row by default", () => {
    const els = elements()
    const picker = mountMovePicker(els)
    picker.open(FOLDERS, vi.fn())

    expect(activeRow(els)).toBe(rows(els)[0])
  })

  it("filters rows by a case-insensitive substring match on the label", () => {
    const els = elements()
    const picker = mountMovePicker(els)
    picker.open(FOLDERS, vi.fn())

    type(els, "IDEAS")

    expect(rows(els).map((r) => r.textContent)).toEqual(["projects/ideas"])
  })

  it("re-renders fresh on every open() call, replacing prior rows", () => {
    const els = elements()
    const picker = mountMovePicker(els)
    picker.open(FOLDERS, vi.fn())
    picker.open(["only"], vi.fn())

    expect(rows(els).map((r) => r.textContent)).toEqual(["only"])
  })
})

describe("mountMovePicker picking a destination (FEAT-0070)", () => {
  it("calls onPick with the row's path and closes on success", async () => {
    const els = elements()
    const onPick = vi.fn().mockResolvedValue({ ok: true })
    const picker = mountMovePicker(els)
    picker.open(FOLDERS, onPick)

    rows(els)[1].click() // "projects"
    await Promise.resolve()
    await Promise.resolve()

    expect(onPick).toHaveBeenCalledWith("projects")
    expect(picker.isOpen()).toBe(false)
  })

  it("shows the failure reason and stays open when onPick reports failure", async () => {
    const els = elements()
    const onPick = vi.fn().mockResolvedValue({ ok: false, reason: "A folder already exists there." })
    const picker = mountMovePicker(els)
    picker.open(FOLDERS, onPick)

    rows(els)[1].click()
    await Promise.resolve()
    await Promise.resolve()

    expect(els.error.hidden).toBe(false)
    expect(els.error.textContent).toBe("A folder already exists there.")
    expect(picker.isOpen()).toBe(true)
  })

  it("Enter picks the highlighted row", async () => {
    const els = elements()
    const onPick = vi.fn().mockResolvedValue({ ok: true })
    const picker = mountMovePicker(els)
    picker.open(FOLDERS, onPick)

    key(els, "ArrowDown")
    key(els, "Enter")
    await Promise.resolve()
    await Promise.resolve()

    expect(onPick).toHaveBeenCalledWith("projects")
  })
})

describe("mountMovePicker closing (FEAT-0070)", () => {
  it("Escape closes without picking", () => {
    const els = elements()
    const onPick = vi.fn()
    const picker = mountMovePicker(els)
    picker.open(FOLDERS, onPick)

    key(els, "Escape")

    expect(picker.isOpen()).toBe(false)
    expect(onPick).not.toHaveBeenCalled()
  })

  it("a backdrop click closes without picking", () => {
    const els = elements()
    const onPick = vi.fn()
    const picker = mountMovePicker(els)
    picker.open(FOLDERS, onPick)

    els.backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true }))

    expect(picker.isOpen()).toBe(false)
    expect(onPick).not.toHaveBeenCalled()
  })
})
