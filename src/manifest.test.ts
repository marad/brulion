/// <reference types="vite/client" />
import { describe, it, expect } from "vitest"
import manifestRaw from "../public/manifest.webmanifest?raw"
import indexHtml from "../index.html?raw"

// FEAT-0028 — the Web App Manifest and the icons it references are static build
// assets in public/ (Vite copies public/** verbatim to the build root under the
// /brulion/ base). These tests validate the shipped manifest, the icon files it
// points at, and the <head> wiring in index.html. Read through Vite's own ?raw /
// import.meta.glob so no Node fs typings are needed.

const base = "/brulion/"
const manifest = JSON.parse(manifestRaw)

// The set of files Vite copies from public/icons/ — keys are the matched paths;
// non-eager glob records them at build time without loading the binaries.
const publicIcons = import.meta.glob("../public/icons/*")
const iconBasenames = new Set(
  Object.keys(publicIcons).map((p) => p.split("/").pop()),
)
const referencedFileExists = (url: string) => iconBasenames.has(url.split("/").pop())

describe("FEAT-0028 web app manifest", () => {
  it("AC-1: declares the required install metadata", () => {
    expect(manifest.name).toBeTruthy()
    expect(manifest.short_name).toBeTruthy()
    expect(manifest.display).toBe("standalone")
    expect(manifest.theme_color).toBeTruthy()
    expect(manifest.background_color).toBeTruthy()
    expect(manifest.start_url.startsWith(base)).toBe(true)
    expect(manifest.scope.startsWith(base)).toBe(true)
    expect(Array.isArray(manifest.icons) && manifest.icons.length > 0).toBe(true)
  })

  it("AC-2: references real 192/512 icons including a maskable one", () => {
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes)
    expect(sizes).toContain("192x192")
    expect(sizes).toContain("512x512")

    const hasMaskable = manifest.icons.some((i: { purpose?: string }) =>
      (i.purpose ?? "").split(/\s+/).includes("maskable"),
    )
    expect(hasMaskable).toBe(true)

    for (const icon of manifest.icons as { src: string }[]) {
      expect(referencedFileExists(icon.src), `missing icon ${icon.src}`).toBe(true)
    }
  })

  it("AC-3: index.html wires manifest, theme-color, and apple-touch-icon", () => {
    const manifestLink = indexHtml.match(/<link[^>]+rel="manifest"[^>]+href="([^"]+)"/)
    expect(manifestLink, "no <link rel=manifest>").toBeTruthy()
    expect(manifestLink![1]).toBe(base + "manifest.webmanifest")

    const themeMeta = indexHtml.match(/<meta[^>]+name="theme-color"[^>]+content="([^"]+)"/)
    expect(themeMeta, "no theme-color meta").toBeTruthy()
    expect(themeMeta![1]).toBe(manifest.theme_color)

    const appleIcon = indexHtml.match(/<link[^>]+rel="apple-touch-icon"[^>]+href="([^"]+)"/)
    expect(appleIcon, "no apple-touch-icon link").toBeTruthy()
    expect(referencedFileExists(appleIcon![1]), "apple-touch-icon file missing").toBe(true)
  })
})
