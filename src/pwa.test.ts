import { describe, it, expect, vi } from "vitest"
import { registerServiceWorker } from "./pwa"

// FEAT-0029 — the registration helper. The worker's caching strategy itself is
// integration-level (real Cache API, real fetch) and is covered by the offline
// e2e against `vite preview`; here we pin the production-only gate, the base-path
// wiring, and the safe degrade.

const fakeNav = (register: unknown) =>
  ({ serviceWorker: { register } }) as unknown as Navigator

describe("FEAT-0029 registerServiceWorker", () => {
  it("AC-1a: does nothing when disabled (dev build)", () => {
    const register = vi.fn().mockResolvedValue(undefined)
    registerServiceWorker(fakeNav(register), "/brulion/", false)
    expect(register).not.toHaveBeenCalled()
  })

  it("AC-1b: registers sw.js under the base with base scope when enabled", () => {
    const register = vi.fn().mockResolvedValue(undefined)
    registerServiceWorker(fakeNav(register), "/brulion/", true)
    expect(register).toHaveBeenCalledWith("/brulion/sw.js", { scope: "/brulion/" })
  })

  it("AC-2: no serviceWorker support → returns without throwing, registers nothing", () => {
    const nav = {} as Navigator
    expect(() => registerServiceWorker(nav, "/brulion/", true)).not.toThrow()
  })

  it("a rejected registration does not throw out of the helper", () => {
    const register = vi.fn().mockRejectedValue(new Error("boom"))
    expect(() => registerServiceWorker(fakeNav(register), "/brulion/", true)).not.toThrow()
  })
})
