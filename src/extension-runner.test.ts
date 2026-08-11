import { describe, expect, it } from "vitest"
import { createExtensionBootstrapHtml, EXTENSION_BOOTSTRAP_CHANNEL } from "./extension-runner"

describe("FEAT-0083 extension runner bootstrap", () => {
  it("uses an opaque-origin, no-network bootstrap with blob module loading", () => {
    const html = createExtensionBootstrapHtml()
    expect(EXTENSION_BOOTSTRAP_CHANNEL).toBe("brulion-extension-bootstrap")
    expect(html).toContain("default-src 'none'")
    expect(html).toContain("script-src 'unsafe-inline' blob:")
    expect(html).toContain("event.source !== window.parent")
    expect(html).toContain("URL.createObjectURL(new Blob")
    expect(html).toContain("runtime.ready")
    expect(html).toContain("commands.register")
    expect(html).toContain("navigation: {")
    expect(html).toContain('getActiveNote: () => call("navigation.getActiveNote", null)')
    expect(html).toContain('openNote: (path, options) => call("navigation.openNote", { path, options })')
    expect(html).toContain('resolveLink: (target, options) => call("navigation.resolveLink", { target, options })')
    expect(html).not.toContain("globalThis.brulion.getActiveNote")
  })

  it("does not interpolate extension source into HTML", () => {
    const html = createExtensionBootstrapHtml()
    const hostileSource = "</script><script>window.parent.pwned = true</script>"
    expect(html).not.toContain(hostileSource)
  })
})
