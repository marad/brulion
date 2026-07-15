/**
 * The app's own confirm/prompt/alert dialog (M35/FEAT-0073), replacing the
 * native `window.confirm`/`window.prompt`/`window.alert` calls the sidebar
 * tree used through P1-P4 — same shape as `move-picker.ts`'s `mount(els)`
 * over pre-declared (initially hidden) DOM, so it's one more instance of the
 * app's existing modal family, not a new one.
 */

/** The DOM nodes the dialog drives (all pre-existing, initially hidden). */
export interface DialogElements {
  /** The full-screen backdrop; toggled via `[hidden]`, click-to-close. */
  backdrop: HTMLElement
  /** The dialog box itself (for future use — not directly manipulated here). */
  dialog: HTMLElement
  message: HTMLElement
  /** Shown only in prompt mode. */
  input: HTMLInputElement
  /** Hidden in alert mode (a single dismiss button covers that case). */
  cancelButton: HTMLButtonElement
  confirmButton: HTMLButtonElement
}

export interface Dialog {
  /** A yes/no choice; resolves `true` only if `confirmButton` is chosen. */
  confirm(message: string, confirmLabel?: string): Promise<boolean>
  /** A single-line text prompt; resolves the input's value, or `null` if cancelled. */
  prompt(message: string, initialValue?: string, confirmLabel?: string): Promise<string | null>
  /** A single-button acknowledgement; resolves once dismissed. */
  alert(message: string): Promise<void>
  /** Detach event listeners (for teardown/tests). */
  destroy(): void
}

type Mode = "confirm" | "prompt" | "alert"

/** Mount the dialog over its (hidden) DOM nodes. */
export function mountDialog(els: DialogElements): Dialog {
  const { backdrop, message, input, cancelButton, confirmButton } = els
  let open = false
  let restoreFocus: HTMLElement | null = null
  let resolveCurrent: ((value: string | null) => void) | null = null
  /** Serializes calls: a `show()` that arrives while one is already open
   * waits its turn instead of superseding the pending one — otherwise an
   * unrelated async flow (e.g. a background move failing) could silently
   * cancel a confirm/prompt the user hasn't answered yet (M35/FEAT-0073
   * review fix). */
  let queue: Promise<void> = Promise.resolve()

  function close(value: string | null): void {
    if (!open) return
    open = false
    backdrop.hidden = true
    const resolve = resolveCurrent
    resolveCurrent = null
    restoreFocus?.focus?.()
    restoreFocus = null
    resolve?.(value)
  }

  function openNow(mode: Mode, text: string, initialValue: string, confirmLabel: string): Promise<string | null> {
    open = true
    message.textContent = text
    input.hidden = mode !== "prompt"
    cancelButton.hidden = mode === "alert"
    confirmButton.textContent = mode === "alert" ? "OK" : confirmLabel
    restoreFocus = document.activeElement as HTMLElement | null
    backdrop.hidden = false
    if (mode === "prompt") {
      input.value = initialValue
      input.focus()
      input.setSelectionRange(input.value.length, input.value.length)
    } else {
      confirmButton.focus()
    }
    return new Promise((resolve) => {
      resolveCurrent = resolve
    })
  }

  /** Opens right away if nothing is showing; otherwise queues behind
   * whatever's already open so it appears only once that's been answered. */
  function show(mode: Mode, text: string, initialValue: string, confirmLabel: string): Promise<string | null> {
    const result = open
      ? queue.then(() => openNow(mode, text, initialValue, confirmLabel))
      : openNow(mode, text, initialValue, confirmLabel)
    queue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  function onConfirmClick(): void {
    const isPrompt = !input.hidden
    close(isPrompt ? input.value : "")
  }
  function onCancelClick(): void {
    close(null)
  }
  function onKeydown(event: KeyboardEvent): void {
    if (!open) return
    if (event.key === "Escape") close(null)
    else if (event.key === "Enter" && document.activeElement === input) onConfirmClick()
  }
  function onBackdropClick(event: MouseEvent): void {
    if (event.target === backdrop) close(null)
  }

  confirmButton.addEventListener("click", onConfirmClick)
  cancelButton.addEventListener("click", onCancelClick)
  document.addEventListener("keydown", onKeydown, true)
  backdrop.addEventListener("click", onBackdropClick)

  return {
    confirm: (msg, confirmLabel = "OK") => show("confirm", msg, "", confirmLabel).then((v) => v !== null),
    prompt: (msg, initialValue = "", confirmLabel = "OK") => show("prompt", msg, initialValue, confirmLabel),
    alert: (msg) => show("alert", msg, "", "OK").then(() => undefined),
    destroy() {
      confirmButton.removeEventListener("click", onConfirmClick)
      cancelButton.removeEventListener("click", onCancelClick)
      document.removeEventListener("keydown", onKeydown, true)
      backdrop.removeEventListener("click", onBackdropClick)
      close(null)
    },
  }
}
