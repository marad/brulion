import { describe, it, expect, vi } from "vitest"
import { wireFlushOnHide } from "./flush"

function setHidden(value: boolean) {
  Object.defineProperty(document, "hidden", { value, configurable: true })
}

describe("wireFlushOnHide", () => {
  it("flushes on window blur", () => {
    const flush = vi.fn()
    wireFlushOnHide(flush)

    window.dispatchEvent(new Event("blur"))

    expect(flush).toHaveBeenCalledTimes(1)
  })

  it("flushes on visibilitychange when the document is hidden", () => {
    const flush = vi.fn()
    wireFlushOnHide(flush)

    setHidden(true)
    document.dispatchEvent(new Event("visibilitychange"))

    expect(flush).toHaveBeenCalledTimes(1)
  })

  it("does not flush on visibilitychange while the document is visible", () => {
    const flush = vi.fn()
    wireFlushOnHide(flush)

    setHidden(false)
    document.dispatchEvent(new Event("visibilitychange"))

    expect(flush).not.toHaveBeenCalled()
  })
})
