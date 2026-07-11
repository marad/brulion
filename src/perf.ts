/**
 * Lightweight performance overlay, active only when `?debug` is in the URL.
 * Usage: track("label", () => someAsyncOp()) or trackSync("label", () => syncOp())
 *
 * Also self-instruments two things no call site has to opt into: any main-thread
 * stall over 50ms (`longtask`, whatever caused it — GC, a background poll tick,
 * decoration building) and tab visibility transitions (background/foreground,
 * where Chrome's own throttling can cause a stutter on return). Ctrl+Shift+L,
 * or the "Copy log" button in the overlay itself (for a phone with no
 * keyboard attached), copies the full rolling log to the clipboard — meant
 * for capturing a slow moment on a real device right after it happens, to
 * paste back for analysis instead of it being lost the moment the overlay
 * scrolls by.
 */

export const DEBUG = new URLSearchParams(location.search).has("debug")

type Entry = { label: string; ms: number; t: number }
const entries: Entry[] = []
// Enough history to catch a slow moment after the fact (not just the visible
// slice) without growing unbounded over a long session.
const MAX_ENTRIES = 500
// Only the most recent of these render live, so the overlay stays scannable.
const VISIBLE_ENTRIES = 15

function push(label: string, ms: number): void {
  entries.push({ label, ms, t: performance.now() })
  if (entries.length > MAX_ENTRIES) entries.shift()
  render()
}

export async function track<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!DEBUG) return fn()
  const t = performance.now()
  try { return await fn() } finally { push(label, performance.now() - t) }
}

export function trackSync<T>(label: string, fn: () => T): T {
  if (!DEBUG) return fn()
  const t = performance.now()
  try { return fn() } finally { push(label, performance.now() - t) }
}

export function mark(label: string): void {
  if (!DEBUG) return
  push(label, 0)
}

/** The full rolling log as pretty JSON, for pasting elsewhere. Chrome-only
 * `performance.memory` (absent on other engines) is included when available —
 * this app is Chromium-only already (the File System Access API). */
export function exportLog(): string {
  const memory = (performance as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      memory: memory ? { usedMB: Math.round(memory.usedJSHeapSize / 1e6), limitMB: Math.round(memory.jsHeapSizeLimit / 1e6) } : null,
      entries,
    },
    null,
    2,
  )
}

function copyExportToClipboard(): void {
  void navigator.clipboard.writeText(exportLog()).then(
    () => mark(`log copied (${entries.length} entries)`),
    () => mark("log copy failed"),
  )
}

if (DEBUG) {
  // Any main-thread stall over 50ms, regardless of cause — a GC pause, a
  // background poll tick's actual CPU work, decoration building — without
  // having to guess which subsystem to instrument next. Chrome-only API;
  // degrades silently where unsupported.
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        push(`long task`, entry.duration)
      }
    }).observe({ type: "longtask", buffered: true })
  } catch {
    // longtask not supported in this engine — nothing to observe
  }

  // Chrome throttles/deprioritizes a backgrounded tab; the first interaction
  // after returning to the foreground can stutter as it catches up. Surfacing
  // the transition makes that pattern visible in the log instead of looking
  // like random jank.
  document.addEventListener("visibilitychange", () => {
    mark(`visibility: ${document.visibilityState}`)
  })

  window.addEventListener("keydown", (event) => {
    if (event.ctrlKey && event.shiftKey && event.code === "KeyL") {
      event.preventDefault()
      copyExportToClipboard()
    }
  })
}

const COPY_BUTTON_ID = "_perf-copy"

function render(): void {
  let el = document.getElementById("_perf")
  if (!el) {
    el = document.createElement("div")
    el.id = "_perf"
    el.style.cssText = [
      "position:fixed", "bottom:0", "left:0", "right:0",
      "background:rgba(0,0,0,.85)", "color:#7fff7f",
      "font:11px/1.5 monospace", "padding:6px 8px",
      "max-height:40vh", "overflow-y:auto",
      "z-index:99999", "pointer-events:none",
      "border-top:1px solid #333",
    ].join(";")
    // Delegated on the container (not the button) so it survives the
    // innerHTML rebuild every render() does below.
    el.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest(`#${COPY_BUTTON_ID}`)) copyExportToClipboard()
    })
    document.body.append(el)
  }
  const copyButtonStyle = [
    "position:sticky", "top:0", "display:block", "width:100%",
    "margin-bottom:4px", "padding:6px", "font:11px/1.5 monospace",
    "background:#2a2a2a", "color:#7fff7f", "border:1px solid #555", "border-radius:3px",
    "pointer-events:auto", // overrides the container's pointer-events:none
  ].join(";")
  const copyButton = `<button id="${COPY_BUTTON_ID}" style="${copyButtonStyle}">Copy log (${entries.length})</button>`
  el.innerHTML = copyButton + entries
    .slice(-VISIBLE_ENTRIES)
    .reverse()
    .map(e =>
      e.ms === 0
        ? `<div style="color:#aaa">— ${e.label}</div>`
        : `<div>${e.label}: <b style="color:${e.ms > 200 ? "#f77" : e.ms > 50 ? "#ff7" : "#7ff"}">${e.ms.toFixed(1)}ms</b></div>`,
    )
    .join("")
}
