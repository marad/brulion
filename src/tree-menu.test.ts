import { describe, it, expect, vi, beforeEach } from "vitest"
import { openTreeMenu, closeTreeMenu } from "./tree-menu"

// DOM contract, mirroring context-menu.ts's (untested, CodeMirror-coupled)
// shape: one .cm-context-menu[role=menu] appended to document.body, one
// button[role=menuitem] per item, positioned via inline left/top styles.
const menu = () => document.querySelector<HTMLElement>(".cm-context-menu")
const items = () => [...document.querySelectorAll<HTMLElement>(".cm-context-menu button[role=menuitem]")]

beforeEach(() => {
  document.body.innerHTML = ""
  closeTreeMenu()
})

describe("openTreeMenu", () => {
  it("opens a menu at the given position with one row per item", () => {
    openTreeMenu(40, 60, [
      { label: "Move…", run: vi.fn() },
      { label: "Delete", run: vi.fn() },
    ])

    expect(menu()).not.toBeNull()
    expect(menu()!.style.left).toBe("40px")
    expect(menu()!.style.top).toBe("60px")
    expect(items().map((el) => el.textContent)).toEqual(["Move…", "Delete"])
  })

  it("does nothing when given no items", () => {
    openTreeMenu(10, 10, [])
    expect(menu()).toBeNull()
  })

  it("replaces an already-open menu instead of stacking a second one", () => {
    openTreeMenu(10, 10, [{ label: "A", run: vi.fn() }])
    openTreeMenu(20, 20, [{ label: "B", run: vi.fn() }])

    expect(document.querySelectorAll(".cm-context-menu")).toHaveLength(1)
    expect(items().map((el) => el.textContent)).toEqual(["B"])
  })

  it("clicking an item runs it and closes the menu", () => {
    const run = vi.fn()
    openTreeMenu(10, 10, [{ label: "Delete", run }])

    items()[0].click()

    expect(run).toHaveBeenCalledOnce()
    expect(menu()).toBeNull()
  })

  it("Escape closes the menu without running anything", () => {
    const run = vi.fn()
    openTreeMenu(10, 10, [{ label: "Delete", run }])

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))

    expect(run).not.toHaveBeenCalled()
    expect(menu()).toBeNull()
  })

  it("a pointerdown outside the menu closes it without running anything", () => {
    const run = vi.fn()
    openTreeMenu(10, 10, [{ label: "Delete", run }])

    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }))

    expect(run).not.toHaveBeenCalled()
    expect(menu()).toBeNull()
  })

  it("a pointerdown inside the menu does not close it", () => {
    openTreeMenu(10, 10, [{ label: "Delete", run: vi.fn() }])

    items()[0].dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }))

    expect(menu()).not.toBeNull()
  })
})

describe("closeTreeMenu", () => {
  it("closes an open menu", () => {
    openTreeMenu(10, 10, [{ label: "Delete", run: vi.fn() }])
    closeTreeMenu()
    expect(menu()).toBeNull()
  })

  it("is a no-op when nothing is open", () => {
    expect(() => closeTreeMenu()).not.toThrow()
  })
})
