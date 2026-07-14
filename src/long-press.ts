/**
 * A long-press gesture (M35/FEAT-0071) — the touch-device equivalent of a
 * right-click, since a touch device has no right-click at all. Holding a
 * single touch point in place past a short threshold fires the callback at
 * the touch's coordinates; moving past a small tolerance, lifting early, a
 * second simultaneous touch, or a cancelled touch all abort it silently.
 */

const LONG_PRESS_MS = 500
const MOVE_TOLERANCE_PX = 10

/** Wire a long-press gesture on `el`. `onLongPress(x, y)` fires once the
 * threshold elapses with the touch held still; an early lift behaves as an
 * ordinary tap (its `touchend` is left alone), but the `touchend` that ends a
 * fired long-press is `preventDefault()`ed so the synthetic click a touch
 * browser would otherwise dispatch next doesn't also run the row's normal
 * tap action. */
export function wireLongPress(
  el: HTMLElement,
  onLongPress: (x: number, y: number) => void,
  ms: number = LONG_PRESS_MS,
): void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let startX = 0
  let startY = 0
  let fired = false

  const cancel = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  el.addEventListener("touchstart", (event) => {
    const touches = (event as unknown as { touches: ArrayLike<{ clientX: number; clientY: number }> }).touches
    cancel()
    if (touches.length !== 1) return // a pinch/second finger is never a long-press
    startX = touches[0].clientX
    startY = touches[0].clientY
    fired = false
    timer = setTimeout(() => {
      fired = true
      onLongPress(startX, startY)
    }, ms)
  })

  el.addEventListener("touchmove", (event) => {
    const touches = (event as unknown as { touches: ArrayLike<{ clientX: number; clientY: number }> }).touches
    const touch = touches[0]
    if (!touch) return
    if (Math.abs(touch.clientX - startX) > MOVE_TOLERANCE_PX || Math.abs(touch.clientY - startY) > MOVE_TOLERANCE_PX) {
      cancel()
    }
  })

  el.addEventListener("touchend", (event) => {
    cancel()
    if (fired) event.preventDefault() // suppress the synthetic click that would otherwise follow
  })

  el.addEventListener("touchcancel", cancel)
}
