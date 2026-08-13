import { afterEach, describe, expect, it, vi } from "vitest"
// @ts-expect-error Node is available to Vitest but this project does not ship node typings.
import { readFileSync } from "node:fs"
import {
  detachVaultInteractions,
  mountNotificationCenter,
  renderMessageContent,
} from "./extension-interactions"

describe("FEAT-0104 formatted messages", () => {
  it("renders safe text, formatting elements, and semantic line breaks", () => {
    const root = document.createElement("div")
    renderMessageContent(root, [
      { type: "text", text: "hello\n" },
      { type: "strong", text: "<b>bold</b>" },
      { type: "code", text: "x\ny" },
    ])
    expect(root.innerHTML).toBe("hello<br><strong>&lt;b&gt;bold&lt;/b&gt;</strong><code>x<br>y</code>")
    expect(root.querySelectorAll("a, b")).toHaveLength(0)
    expect(root.textContent).toBe("hello<b>bold</b>xy")
  })

  it("limits visible and queued notifications, promotes FIFO, and dismisses", () => {
    vi.useFakeTimers()
    const region = document.createElement("div")
    const center = mountNotificationCenter(region)
    for (let i = 1; i <= 12; i++) center.show(`message ${i}`, `m${i}`, "info")
    expect(region.querySelectorAll(".notification-toast")).toHaveLength(3)
    expect(center.queuedCount).toBe(8)
    expect(region.textContent).toContain("message 1")
    const firstClose = region.querySelector<HTMLButtonElement>("button")!
    firstClose.click()
    expect(region.textContent).toContain("message 4")
    expect(region.textContent).not.toContain("message 12")
    vi.advanceTimersByTime(4000)
    expect(region.querySelectorAll(".notification-toast")).toHaveLength(3)
    center.clear()
    expect(region.childElementCount).toBe(0)
    vi.useRealTimers()
  })

  it("clears only the disposed source, including queued notifications", () => {
    const region = document.createElement("div")
    const center = mountNotificationCenter(region)
    for (let i = 0; i < 3; i++) center.show(`alpha visible ${i}`, "alpha", "info")
    for (let i = 0; i < 2; i++) center.show(`alpha queued ${i}`, "alpha", "info")
    center.show("beta", "beta", "success")

    center.clearSource("alpha")

    expect(region.textContent).toContain("beta")
    expect(region.textContent).not.toContain("alpha")
    expect(center.queuedCount).toBe(0)
  })

  it("clears the detached vault before a replacement root starts loading, but not on reload", () => {
    const oldRoot = {} as FileSystemDirectoryHandle
    const newRoot = {} as FileSystemDirectoryHandle
    const disposeRunners = vi.fn()
    const clearNotifications = vi.fn()

    detachVaultInteractions(oldRoot, newRoot, disposeRunners, clearNotifications)
    expect(disposeRunners).toHaveBeenCalledOnce()
    expect(clearNotifications).toHaveBeenCalledOnce()

    disposeRunners.mockClear()
    clearNotifications.mockClear()
    detachVaultInteractions(newRoot, newRoot, disposeRunners, clearNotifications)
    expect(disposeRunners).not.toHaveBeenCalled()
    expect(clearNotifications).not.toHaveBeenCalled()
  })

  it("keeps notification styles on the defined muted text token", () => {
    const css = readFileSync("src/styles.css", "utf8")
    expect(css).toContain(".notification-source { grid-column: 1; color: var(--text-muted);")
    expect(css).toContain("color: var(--text-muted); font: inherit; cursor: pointer;")
    expect(css).not.toContain("var(--muted)")
  })

  afterEach(() => vi.useRealTimers())
})
