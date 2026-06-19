/**
 * Flush pending edits before the page can go away: on window blur and when the
 * tab is hidden. These are the focus-loss safety nets that close the gap
 * between the last keystroke and the autosave debounce.
 */
export function wireFlushOnHide(flush: () => void): void {
  window.addEventListener("blur", flush)
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) flush()
  })
}
