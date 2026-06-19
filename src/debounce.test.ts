import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { debounce } from "./debounce"

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe("debounce", () => {
  it("runs fn once after the window elapses", () => {
    const fn = vi.fn()
    const d = debounce(fn, 600)

    d.trigger()
    vi.advanceTimersByTime(599)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("coalesces a burst of triggers into a single run", () => {
    const fn = vi.fn()
    const d = debounce(fn, 600)

    d.trigger()
    vi.advanceTimersByTime(300)
    d.trigger()
    vi.advanceTimersByTime(300)
    d.trigger()
    vi.advanceTimersByTime(600)

    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("cancel prevents a pending run", () => {
    const fn = vi.fn()
    const d = debounce(fn, 600)

    d.trigger()
    d.cancel()
    vi.advanceTimersByTime(600)

    expect(fn).not.toHaveBeenCalled()
  })
})
