import { afterEach, describe, expect, it, vi } from "vitest"
import { mountNotificationCenter, renderMessageContent } from "./extension-interactions"

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

  it("clears only the disposed source", () => {
    const region = document.createElement("div")
    const center = mountNotificationCenter(region)
    center.show("one", "alpha", "info")
    center.show("two", "beta", "success")
    center.clearSource("alpha")
    expect(region.textContent).toContain("twobeta")
  })

  afterEach(() => vi.useRealTimers())
})
