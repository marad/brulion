export interface Debounced {
  /** (Re)start the timer; `fn` runs once it elapses with no further trigger. */
  trigger(): void
  /** Cancel a pending run, if any. */
  cancel(): void
}

/** Run `fn` once, `ms` after the last `trigger()`. Coalesces bursts. */
export function debounce(fn: () => void, ms: number): Debounced {
  let timer: ReturnType<typeof setTimeout> | undefined

  return {
    trigger() {
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        fn()
      }, ms)
    },
    cancel() {
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
    },
  }
}
