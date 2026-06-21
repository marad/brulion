import { describe, it, expect, vi } from "vitest"
import { createInstallPrompt } from "./install-prompt"

// FEAT-0030 — the pure install-affordance controller. A fake deferred event
// stands in for the real BeforeInstallPromptEvent; setVisible is the only DOM
// touch, injected by the caller.
const fakeEvent = () => ({ preventDefault: vi.fn(), prompt: vi.fn() })

describe("FEAT-0030 createInstallPrompt", () => {
  it("AC-1: a captured event reveals the button and suppresses the default", () => {
    const setVisible = vi.fn()
    const event = fakeEvent()
    const install = createInstallPrompt(false, setVisible)

    install.onBeforeInstallPrompt(event)

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(setVisible).toHaveBeenCalledWith(true)
  })

  it("AC-2: standalone never shows the button and does not stash", () => {
    const setVisible = vi.fn()
    const event = fakeEvent()
    const install = createInstallPrompt(true, setVisible)

    install.onBeforeInstallPrompt(event)

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(setVisible).not.toHaveBeenCalledWith(true)

    // With nothing stashed, a click prompts nothing.
    install.onInstallClick()
    expect(event.prompt).not.toHaveBeenCalled()
  })

  it("AC-3: clicking fires prompt once, hides, and a second click is inert", () => {
    const setVisible = vi.fn()
    const event = fakeEvent()
    const install = createInstallPrompt(false, setVisible)
    install.onBeforeInstallPrompt(event)
    setVisible.mockClear()

    install.onInstallClick()
    expect(event.prompt).toHaveBeenCalledOnce()
    expect(setVisible).toHaveBeenCalledWith(false)

    install.onInstallClick()
    expect(event.prompt).toHaveBeenCalledOnce() // still once — single-use
  })

  it("AC-4: appinstalled clears the stash and hides; a later click prompts nothing", () => {
    const setVisible = vi.fn()
    const event = fakeEvent()
    const install = createInstallPrompt(false, setVisible)
    install.onBeforeInstallPrompt(event)
    setVisible.mockClear()

    install.onInstalled()
    expect(setVisible).toHaveBeenCalledWith(false)

    install.onInstallClick()
    expect(event.prompt).not.toHaveBeenCalled()
  })
})
