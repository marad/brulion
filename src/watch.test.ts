import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createPoller } from "./watch"

describe("createPoller", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("invokes tick once per elapsed interval after start (AC-1)", async () => {
    const tick = vi.fn(async () => {})
    const poller = createPoller(tick, 100)

    poller.start()
    await vi.advanceTimersByTimeAsync(300)

    expect(tick).toHaveBeenCalledTimes(3)
  })

  it("does not tick before the first interval elapses", async () => {
    const tick = vi.fn(async () => {})
    const poller = createPoller(tick, 100)

    poller.start()
    await vi.advanceTimersByTimeAsync(99)

    expect(tick).not.toHaveBeenCalled()
  })

  it("never overlaps runs: skips beats while a tick is still pending, then resumes (AC-2)", async () => {
    let release: () => void = () => {}
    const tick = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    const poller = createPoller(tick, 100)

    poller.start()
    // First beat fires the tick; its promise stays pending.
    await vi.advanceTimersByTimeAsync(100)
    expect(tick).toHaveBeenCalledTimes(1)

    // Several more intervals elapse while the tick is still in flight: skipped.
    await vi.advanceTimersByTimeAsync(300)
    expect(tick).toHaveBeenCalledTimes(1)

    // Resolve the in-flight tick; the poller can beat again afterwards.
    release()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(100)
    expect(tick).toHaveBeenCalledTimes(2)
  })

  it("runs no further ticks after stop (AC-3)", async () => {
    const tick = vi.fn(async () => {})
    const poller = createPoller(tick, 100)

    poller.start()
    await vi.advanceTimersByTimeAsync(100)
    expect(tick).toHaveBeenCalledTimes(1)

    poller.stop()
    await vi.advanceTimersByTimeAsync(500)
    expect(tick).toHaveBeenCalledTimes(1)
  })

  it("does not fire a beat that already elapsed once stopped (AC-3)", async () => {
    const tick = vi.fn(async () => {})
    const poller = createPoller(tick, 100)

    poller.start()
    // Almost a full interval has passed, but no beat has fired yet.
    await vi.advanceTimersByTimeAsync(99)
    poller.stop()
    await vi.advanceTimersByTimeAsync(100)

    expect(tick).not.toHaveBeenCalled()
  })

  it("restarts cleanly after a stop while a tick was still in flight (AC-3)", async () => {
    let release: () => void = () => {}
    const tick = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    const poller = createPoller(tick, 100)

    poller.start()
    await vi.advanceTimersByTimeAsync(100) // first beat fires; tick stays pending
    expect(tick).toHaveBeenCalledTimes(1)

    poller.stop() // stopped mid-tick — the in-flight run is abandoned
    poller.start() // restart should not be wedged by the abandoned tick

    await vi.advanceTimersByTimeAsync(100)
    expect(tick).toHaveBeenCalledTimes(2) // the restarted poller beats again

    release()
  })

  it("calling start twice does not double-arm (no double-rate ticking) (AC-3)", async () => {
    const tick = vi.fn(async () => {})
    const poller = createPoller(tick, 100)

    poller.start()
    poller.start()
    await vi.advanceTimersByTimeAsync(300)

    expect(tick).toHaveBeenCalledTimes(3)
  })
})
