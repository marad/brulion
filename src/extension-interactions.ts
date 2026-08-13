import type { MessageContent, MessagePart, NotificationLevel } from "./extension-host"

const MAX_VISIBLE = 3
const MAX_QUEUED = 8
const DISMISS_MS = 4000

type Item = {
  readonly source: string
  readonly content: MessageContent
  readonly level: NotificationLevel
}

type Visible = Item & { readonly element: HTMLElement; readonly timer: ReturnType<typeof setTimeout> }

/** Append validated extension message content as host-owned, safe DOM nodes. */
export function renderMessageContent(root: HTMLElement, content: MessageContent): void {
  const parts: readonly MessagePart[] = typeof content === "string"
    ? [{ type: "text", text: content }]
    : content
  for (const part of parts) {
    const parent = part.type === "strong" ? document.createElement("strong")
      : part.type === "code" ? document.createElement("code")
      : root
    const fragments = part.text.split("\n")
    fragments.forEach((fragment, index) => {
      if (index > 0) parent.append(document.createElement("br"))
      parent.append(document.createTextNode(fragment))
    })
    if (parent !== root) root.append(parent)
  }
}

export interface NotificationCenterHandle {
  show(content: MessageContent, source: string, level: NotificationLevel): void
  clearSource(source: string): void
  clear(): void
  readonly queuedCount: number
}

/** Host-owned, bounded notification queue mounted outside the editor surface. */
export function mountNotificationCenter(region: HTMLElement): NotificationCenterHandle {
  region.setAttribute("aria-live", "polite")
  region.setAttribute("aria-label", "Notifications")
  const visible: Visible[] = []
  const queued: Item[] = []

  const removeVisible = (item: Visible): void => {
    const index = visible.indexOf(item)
    if (index < 0) return
    clearTimeout(item.timer)
    visible.splice(index, 1)
    item.element.remove()
    promote()
  }
  const render = (item: Item): Visible => {
    const toast = document.createElement("article")
    toast.className = "notification-toast"
    toast.dataset.level = item.level
    const message = document.createElement("div")
    message.className = "notification-message"
    renderMessageContent(message, item.content)
    const attribution = document.createElement("div")
    attribution.className = "notification-source"
    attribution.textContent = item.source
    const close = document.createElement("button")
    close.type = "button"
    close.className = "notification-close"
    close.setAttribute("aria-label", "Dismiss notification")
    close.textContent = "×"
    toast.append(message, attribution, close)
    region.append(toast)
    const result = { ...item, element: toast, timer: setTimeout(() => removeVisible(result), DISMISS_MS) }
    close.addEventListener("click", () => removeVisible(result))
    return result
  }
  function promote(): void {
    while (visible.length < MAX_VISIBLE && queued.length > 0) visible.push(render(queued.shift()!))
  }
  const handle: NotificationCenterHandle = {
    show(content, source, level) {
      const item = { content, source, level }
      if (visible.length < MAX_VISIBLE) visible.push(render(item))
      else if (queued.length < MAX_QUEUED) queued.push(item)
    },
    clearSource(source) {
      for (let index = queued.length - 1; index >= 0; index--) {
        if (queued[index].source === source) queued.splice(index, 1)
      }
      for (const item of [...visible]) if (item.source === source) removeVisible(item)
    },
    clear() {
      queued.length = 0
      for (const item of [...visible]) {
        clearTimeout(item.timer)
        item.element.remove()
      }
      visible.length = 0
    },
    get queuedCount() { return queued.length },
  }
  return handle
}
