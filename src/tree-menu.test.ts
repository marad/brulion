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

describe("openTreeMenu keyboard operation (FEAT-0071/AC-8)", () => {
  const key = (k: string) =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }))

  it("a keyboard-opened menu focuses its first item", () => {
    openTreeMenu(10, 10, [{ label: "A", run: vi.fn() }, { label: "B", run: vi.fn() }], {
      fromKeyboard: true,
    })
    expect(document.activeElement).toBe(items()[0])
  })

  it("ArrowDown/ArrowUp move focus between items, wrapping at both ends", () => {
    openTreeMenu(
      10,
      10,
      [{ label: "A", run: vi.fn() }, { label: "B", run: vi.fn() }, { label: "C", run: vi.fn() }],
      { fromKeyboard: true },
    )
    key("ArrowDown")
    expect(document.activeElement).toBe(items()[1])
    key("ArrowDown")
    expect(document.activeElement).toBe(items()[2])
    key("ArrowDown") // wraps to first
    expect(document.activeElement).toBe(items()[0])
    key("ArrowUp") // wraps to last
    expect(document.activeElement).toBe(items()[2])
  })

  it("Enter activates the focused item and closes the menu", () => {
    const run = vi.fn()
    openTreeMenu(10, 10, [{ label: "A", run: vi.fn() }, { label: "B", run }], {
      fromKeyboard: true,
    })
    key("ArrowDown") // focus B
    key("Enter")
    expect(run).toHaveBeenCalledOnce()
    expect(menu()).toBeNull()
  })

  it("Escape returns focus to the opener via onDismiss", () => {
    const opener = document.createElement("button")
    document.body.append(opener)
    const onDismiss = vi.fn(() => opener.focus())
    openTreeMenu(10, 10, [{ label: "A", run: vi.fn() }], { fromKeyboard: true, onDismiss })

    key("Escape")

    expect(onDismiss).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(opener)
    expect(menu()).toBeNull()
  })

  it("a pointer-opened menu (no fromKeyboard) does not steal focus, and arrows are ignored", () => {
    const elsewhere = document.createElement("input")
    document.body.append(elsewhere)
    elsewhere.focus()

    openTreeMenu(10, 10, [{ label: "A", run: vi.fn() }, { label: "B", run: vi.fn() }])
    expect(document.activeElement).toBe(elsewhere) // focus untouched — pointer is the way in

    key("ArrowDown") // focus is outside the menu, so navigation must not hijack it
    expect(document.activeElement).toBe(elsewhere)
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
