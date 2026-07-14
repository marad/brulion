import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { wireLongPress } from "./long-press"

// happy-dom has no native TouchEvent — a plain Event with a `touches` array
// attached is enough for wireLongPress, which only ever reads `.touches`.
function touchEvent(type: string, points: Array<{ clientX: number; clientY: number }>): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, "touches", { value: points, configurable: true })
  return event
}

let el: HTMLElement

beforeEach(() => {
  vi.useFakeTimers()
  el = document.createElement("div")
  document.body.append(el)
})

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ""
})

describe("wireLongPress", () => {
  it("fires after the threshold when held still (AC-5)", () => {
    const onLongPress = vi.fn()
    wireLongPress(el, onLongPress)

    el.dispatchEvent(touchEvent("touchstart", [{ clientX: 10, clientY: 20 }]))
    vi.advanceTimersByTime(500)

    expect(onLongPress).toHaveBeenCalledWith(10, 20)
  })

  it("does not fire before the threshold elapses", () => {
    const onLongPress = vi.fn()
    wireLongPress(el, onLongPress)

    el.dispatchEvent(touchEvent("touchstart", [{ clientX: 10, clientY: 20 }]))
    vi.advanceTimersByTime(499)

    expect(onLongPress).not.toHaveBeenCalled()
  })

  it("cancels when the touch moves past the tolerance (AC-6)", () => {
    const onLongPress = vi.fn()
    wireLongPress(el, onLongPress)

    el.dispatchEvent(touchEvent("touchstart", [{ clientX: 10, clientY: 20 }]))
    el.dispatchEvent(touchEvent("touchmove", [{ clientX: 30, clientY: 20 }]))
    vi.advanceTimersByTime(500)

    expect(onLongPress).not.toHaveBeenCalled()
  })

  it("does not cancel on a move within the tolerance", () => {
    const onLongPress = vi.fn()
    wireLongPress(el, onLongPress)

    el.dispatchEvent(touchEvent("touchstart", [{ clientX: 10, clientY: 20 }]))
    el.dispatchEvent(touchEvent("touchmove", [{ clientX: 13, clientY: 21 }]))
    vi.advanceTimersByTime(500)

    expect(onLongPress).toHaveBeenCalledOnce()
  })

  it("cancels when the touch lifts early (AC-6)", () => {
    const onLongPress = vi.fn()
    wireLongPress(el, onLongPress)

    el.dispatchEvent(touchEvent("touchstart", [{ clientX: 10, clientY: 20 }]))
    el.dispatchEvent(touchEvent("touchend", []))
    vi.advanceTimersByTime(500)

    expect(onLongPress).not.toHaveBeenCalled()
  })

  it("does not preventDefault on an early lift (an ordinary tap proceeds)", () => {
    const onLongPress = vi.fn()
    wireLongPress(el, onLongPress)

    el.dispatchEvent(touchEvent("touchstart", [{ clientX: 10, clientY: 20 }]))
    const endEvent = touchEvent("touchend", [])
    const preventDefault = vi.spyOn(endEvent, "preventDefault")
    el.dispatchEvent(endEvent)

    expect(preventDefault).not.toHaveBeenCalled()
  })

  it("preventDefaults the touchend once a long-press has fired (suppresses the synthetic click)", () => {
    const onLongPress = vi.fn()
    wireLongPress(el, onLongPress)

    el.dispatchEvent(touchEvent("touchstart", [{ clientX: 10, clientY: 20 }]))
    vi.advanceTimersByTime(500)
    const endEvent = touchEvent("touchend", [])
    const preventDefault = vi.spyOn(endEvent, "preventDefault")
    el.dispatchEvent(endEvent)

    expect(preventDefault).toHaveBeenCalledOnce()
  })

  it("cancels on a second simultaneous touch (not a single-finger press)", () => {
    const onLongPress = vi.fn()
    wireLongPress(el, onLongPress)

    el.dispatchEvent(
      touchEvent("touchstart", [
        { clientX: 10, clientY: 20 },
        { clientX: 50, clientY: 60 },
      ]),
    )
    vi.advanceTimersByTime(500)

    expect(onLongPress).not.toHaveBeenCalled()
  })

  it("touchcancel cancels a pending press", () => {
    const onLongPress = vi.fn()
    wireLongPress(el, onLongPress)

    el.dispatchEvent(touchEvent("touchstart", [{ clientX: 10, clientY: 20 }]))
    el.dispatchEvent(touchEvent("touchcancel", []))
    vi.advanceTimersByTime(500)

    expect(onLongPress).not.toHaveBeenCalled()
  })
})
