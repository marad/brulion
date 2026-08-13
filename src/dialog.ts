import type {
  AlertOptions,
  ConfirmOptions,
  MessageContent,
  PromptOptions,
} from "./extension-host"
import { renderMessageContent } from "./extension-interactions"

/** The DOM nodes shared by application and extension-owned dialogs. */
export interface DialogElements {
  backdrop: HTMLElement
  dialog: HTMLElement
  message: HTMLElement
  input: HTMLInputElement
  /** Optional for hosts/tests that have not adopted multiline prompting yet. */
  textarea?: HTMLTextAreaElement
  cancelButton: HTMLButtonElement
  confirmButton: HTMLButtonElement
  /** True while another host-owned modal surface owns the single modal slot. */
  isBlocked?: () => boolean
}

export interface ExtensionDialogAdapter {
  alert(message: MessageContent, options: AlertOptions, source?: string): Promise<void>
  confirm(message: MessageContent, options: ConfirmOptions, source?: string): Promise<boolean>
  prompt(message: MessageContent, options: PromptOptions, source?: string): Promise<string | null>
  /** Cancel only this extension's active and queued requests. */
  dispose(source: string): void
}

export interface Dialog {
  confirm(message: string, confirmLabel?: string): Promise<boolean>
  prompt(message: string, initialValue?: string, confirmLabel?: string): Promise<string | null>
  alert(message: string): Promise<void>
  readonly extension: ExtensionDialogAdapter
  destroy(): void
}

type Mode = "confirm" | "prompt" | "alert"
type Result = string | boolean | void | null

interface Request {
  readonly mode: Mode
  readonly message: MessageContent
  readonly source?: string
  readonly initial: string
  readonly placeholder?: string
  readonly multiline: boolean
  readonly confirmLabel: string
  readonly cancelLabel: string
  readonly resolve: (value: Result) => void
  readonly reject: (reason: unknown) => void
}

export const DISPOSED_DIALOG_ERROR = "disposed"

function disposedError(source: string): Error & { code: string } {
  const error = new Error(`Extension dialog disposed: ${source}`) as Error & { code: string }
  error.code = DISPOSED_DIALOG_ERROR
  return error
}

/** Mount one queue over the application's existing modal surface. */
export function mountDialog(els: DialogElements): Dialog {
  const { backdrop, message, input, textarea, cancelButton, confirmButton } = els
  const isBlocked = els.isBlocked ?? (() => false)
  const queue: Request[] = []
  let active: Request | null = null
  let restoreFocus: HTMLElement | null = null
  let suspended = false
  let destroyed = false

  function focusRestore(): void {
    const target = restoreFocus
    restoreFocus = null
    if (target && target.isConnected && !target.hidden) target.focus()
  }

  function finish(request: Request, value: Result, error?: unknown): void {
    if (active !== request) return
    active = null
    suspended = false
    backdrop.hidden = true
    if (textarea) textarea.hidden = true
    // Do not steal focus from a host modal that opened while this request was
    // suspended. The observer restores this target once the host surface closes.
    if (!isBlocked()) focusRestore()
    if (error === undefined) request.resolve(value)
    else request.reject(error)
    pump()
  }

  function answer(value: Result): void {
    if (!active) return
    finish(active, value)
  }

  function focusActive(): void {
    const request = active
    if (!request || destroyed || isBlocked()) return
    suspended = false
    backdrop.hidden = false
    if (request.mode === "prompt") {
      const field = request.multiline && textarea ? textarea : input
      field.focus()
      field.setSelectionRange(field.value.length, field.value.length)
    } else confirmButton.focus()
  }

  function render(request: Request): void {
    active = request
    message.replaceChildren()
    renderMessageContent(message, request.message)
    input.hidden = request.mode !== "prompt" || request.multiline
    if (textarea) textarea.hidden = request.mode !== "prompt" || !request.multiline
    cancelButton.hidden = request.mode === "alert"
    confirmButton.textContent = request.confirmLabel
    cancelButton.textContent = request.cancelLabel
    restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (request.mode === "prompt") {
      const field = request.multiline && textarea ? textarea : input
      field.value = request.initial
      field.placeholder = request.placeholder ?? ""
    }
    if (isBlocked()) {
      suspended = true
      backdrop.hidden = true
    } else focusActive()
  }

  function pump(): void {
    if (destroyed || active || queue.length === 0 || isBlocked()) return
    render(queue.shift()!)
  }

  function enqueue(
    mode: Mode,
    content: MessageContent,
    options: {
      source?: string
      initial?: string
      placeholder?: string
      multiline?: boolean
      confirmLabel: string
      cancelLabel: string
    },
  ): Promise<Result> {
    return new Promise<Result>((resolve, reject) => {
      const request: Request = {
        mode,
        message: content,
        source: options.source,
        initial: options.initial ?? "",
        placeholder: options.placeholder,
        multiline: options.multiline ?? false,
        confirmLabel: options.confirmLabel,
        cancelLabel: options.cancelLabel,
        resolve,
        reject,
      }
      if (destroyed) {
        reject(disposedError(options.source ?? "dialog"))
        return
      }
      queue.push(request)
      pump()
    })
  }

  function onConfirmClick(): void {
    if (!active) return
    if (active.mode !== "prompt") {
      answer(active.mode === "alert" ? undefined : true)
      return
    }
    const field = active.multiline && textarea ? textarea : input
    answer(field.value)
  }
  function onCancelClick(): void {
    if (active) answer(active.mode === "confirm" ? false : null)
  }
  function onKeydown(event: KeyboardEvent): void {
    if (!active) return
    if (event.key === "Escape") {
      event.preventDefault()
      onCancelClick()
    } else if (event.key === "Enter" && active.mode === "prompt" && !active.multiline) {
      if (document.activeElement === input) {
        event.preventDefault()
        onConfirmClick()
      }
    }
  }
  function onBackdropClick(event: MouseEvent): void {
    if (event.target === backdrop && active) onCancelClick()
  }

  confirmButton.addEventListener("click", onConfirmClick)
  cancelButton.addEventListener("click", onCancelClick)
  document.addEventListener("keydown", onKeydown, true)
  backdrop.addEventListener("click", onBackdropClick)

  // Existing modal surfaces predate this queue and toggle their own `hidden`
  // attributes. Observe that host-owned signal so a queued request wakes when
  // the surface closes, and suspend an active extension request if a host modal
  // appears asynchronously (for example, an external-change conflict).
  const hostModalObserver = els.isBlocked && typeof MutationObserver !== "undefined"
    ? new MutationObserver(() => {
      if (destroyed) return
      if (active && isBlocked()) {
        suspended = true
        backdrop.hidden = true
      } else if (active && suspended) {
        focusActive()
      } else if (!active && !isBlocked() && restoreFocus) {
        focusRestore()
      }
      pump()
    })
    : null
  if (hostModalObserver && document.documentElement) {
    hostModalObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["hidden"],
      subtree: true,
    })
  }

  const extension: ExtensionDialogAdapter = {
    alert: (content, options, source) => enqueue("alert", content, {
      source, confirmLabel: options.okLabel, cancelLabel: "Cancel",
    }).then(() => undefined),
    confirm: (content, options, source) => enqueue("confirm", content, {
      source, confirmLabel: options.confirmLabel, cancelLabel: options.cancelLabel,
    }).then((value) => value === true),
    prompt: (content, options, source) => enqueue("prompt", content, {
      source, initial: options.initial, placeholder: options.placeholder,
      multiline: options.multiline, confirmLabel: options.confirmLabel, cancelLabel: options.cancelLabel,
    }).then((value) => value === null ? null : value as string),
    dispose(source) {
      const error = disposedError(source)
      for (let index = queue.length - 1; index >= 0; index--) {
        if (queue[index].source !== source) continue
        queue[index].reject(error)
        queue.splice(index, 1)
      }
      if (active?.source === source) finish(active, null, error)
    },
  }

  const result: Dialog = {
    confirm: (text, confirmLabel = "OK") => enqueue("confirm", text, { confirmLabel, cancelLabel: "Cancel" }).then((value) => value === true),
    prompt: (text, initialValue = "", confirmLabel = "OK") => enqueue("prompt", text, { initial: initialValue, confirmLabel, cancelLabel: "Cancel" }).then((value) => value === null ? null : value as string),
    alert: (text) => enqueue("alert", text, { confirmLabel: "OK", cancelLabel: "Cancel" }).then(() => undefined),
    extension,
    destroy() {
      if (destroyed) return
      destroyed = true
      const error = disposedError("dialog")
      for (const request of queue.splice(0)) request.reject(error)
      if (active) finish(active, null, error)
      confirmButton.removeEventListener("click", onConfirmClick)
      cancelButton.removeEventListener("click", onCancelClick)
      document.removeEventListener("keydown", onKeydown, true)
      backdrop.removeEventListener("click", onBackdropClick)
      hostModalObserver?.disconnect()
    },
  }
  return result
}
