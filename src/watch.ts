/**
 * A generic, reusable poller: run an async `tick` on a fixed interval while the
 * app is open, so external changes to the folder are noticed (the detection
 * mechanism for M4 — see DECISIONS.md "Detect external edits by polling").
 *
 * The one hard rule is **no overlapping runs**: if a tick is still in flight
 * when the interval elapses, that beat is skipped rather than starting a second
 * concurrent tick, so slow disk reads can never stack up.
 */

export interface Poller {
  /** Arm the interval. Calling again while already running is a no-op. */
  start(): void
  /** Disarm: no further ticks fire, including a beat already elapsed. */
  stop(): void
}

/**
 * Create a poller that invokes `tick` every `intervalMs`, never overlapping its
 * own runs. The interval (not the tick) drives beats, so a tick that outlives
 * `intervalMs` only delays the next beat; it never reschedules itself.
 */
export function createPoller(
  tick: () => void | Promise<void>,
  intervalMs: number,
): Poller {
  let timer: ReturnType<typeof setInterval> | null = null
  let inFlight = false
  let onVisibility: (() => void) | null = null

  const beat = (): void => {
    if (inFlight) return // a previous tick is still running — skip this beat
    inFlight = true
    void Promise.resolve(tick()).finally(() => {
      inFlight = false
    })
  }

  const arm = (): void => {
    if (timer !== null || document.hidden) return
    timer = setInterval(beat, intervalMs)
  }

  const disarm = (): void => {
    if (timer === null) return
    clearInterval(timer)
    timer = null
    // Forget any in-flight tick so a later start() isn't wedged by a beat
    // that was still running (or never settles) when we stopped.
    inFlight = false
  }

  return {
    start() {
      if (onVisibility !== null) return // already armed
      onVisibility = () => (document.hidden ? disarm() : arm())
      document.addEventListener("visibilitychange", onVisibility)
      arm()
    },
    stop() {
      if (onVisibility !== null) {
        document.removeEventListener("visibilitychange", onVisibility)
        onVisibility = null
      }
      disarm()
    },
  }
}
