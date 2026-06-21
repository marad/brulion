/**
 * Install-affordance controller (FEAT-0030).
 *
 * A pure core over a single stashed `beforeinstallprompt` event, mirroring the
 * FEAT-0020/0021 toggle split: this owns the state and decides visibility,
 * `main.ts` wires the DOM listeners. No persistence, no files — the user's notes
 * are untouched.
 */

/** The subset of `BeforeInstallPromptEvent` we use. */
export interface DeferredInstallPrompt {
  preventDefault(): void
  prompt(): unknown
}

export interface InstallPromptHandlers {
  /** `beforeinstallprompt` fired: stash the event and reveal the affordance. */
  onBeforeInstallPrompt(event: DeferredInstallPrompt): void
  /** The user activated the Install affordance: fire the native prompt, then clear. */
  onInstallClick(): void
  /** `appinstalled` fired: clear the stash and hide. */
  onInstalled(): void
}

export function createInstallPrompt(
  isStandalone: boolean,
  setVisible: (visible: boolean) => void,
): InstallPromptHandlers {
  // The deferred prompt event, stashed between capture and the user's click;
  // null when there's nothing installable to offer.
  let deferred: DeferredInstallPrompt | null = null

  return {
    onBeforeInstallPrompt(event) {
      // Already installed → ignore; never offer to install over a running install.
      if (isStandalone) return
      event.preventDefault() // suppress the browser's default mini-infobar
      deferred = event
      setVisible(true)
    },
    onInstallClick() {
      const event = deferred
      deferred = null // single-use: the deferred event can only be prompted once
      setVisible(false)
      event?.prompt()
      // After a click the affordance stays hidden for this event even if the user
      // dismisses the OS dialog (the event is now spent). If the browser decides
      // the app is still installable it fires `beforeinstallprompt` again, which
      // re-stashes and re-reveals the button.
    },
    onInstalled() {
      deferred = null
      setVisible(false)
    },
  }
}
