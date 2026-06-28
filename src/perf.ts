/**
 * Lightweight performance overlay, active only when `?debug` is in the URL.
 * Usage: track("label", () => someAsyncOp()) or trackSync("label", () => syncOp())
 */

export const DEBUG = new URLSearchParams(location.search).has("debug")

type Entry = { label: string; ms: number }
const entries: Entry[] = []

function push(label: string, ms: number): void {
  entries.push({ label, ms })
  if (entries.length > 30) entries.shift()
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
    document.body.append(el)
  }
  el.innerHTML = entries
    .slice(-15)
    .reverse()
    .map(e =>
      e.ms === 0
        ? `<div style="color:#aaa">— ${e.label}</div>`
        : `<div>${e.label}: <b style="color:${e.ms > 200 ? "#f77" : e.ms > 50 ? "#ff7" : "#7ff"}">${e.ms.toFixed(1)}ms</b></div>`,
    )
    .join("")
}
