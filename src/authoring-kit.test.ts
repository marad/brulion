import { describe, expect, it } from "vitest"
import { parseScriptManifestText } from "./script-manifest"
import {
  AUTHORING_KIT_VERSION,
  getAuthoringKitFile,
  listAuthoringKitFiles,
  serializeAuthoringKit,
} from "./authoring-kit"

describe("versioned extension authoring kit", () => {
  it("contains the complete deterministic kit and a valid disabled template", () => {
    expect(AUTHORING_KIT_VERSION).toBe("1.0.0")
    const files = listAuthoringKitFiles()
    expect(files.map((file) => file.path)).toEqual([
      "template/manifest.json",
      "template/main.js",
      "brulion-extension.d.ts",
      "examples/hello-world/manifest.json",
      "examples/hello-world/main.js",
      "API.md",
      "AGENTS.md",
      "llm-skill.md",
      "authoring-prompt.md",
      "README.md",
    ])
    const manifest = getAuthoringKitFile("template/manifest.json")
    expect(manifest).toBeDefined()
    expect(parseScriptManifestText(manifest!.content)).toMatchObject({ ok: true })
  })

  it("keeps kit files exact and avoids unsupported authoring assumptions", () => {
    const source = getAuthoringKitFile("template/main.js")!.content
    expect(source).toContain("api.commands.register")
    expect(source).not.toMatch(/from\s+["']https?:|setInterval|setTimeout|npm install|\.ts\b/)
    const bundle = serializeAuthoringKit()
    expect(bundle.indexOf("===== template/manifest.json =====")).toBeLessThan(
      bundle.indexOf("===== template/main.js ====="),
    )
    expect(getAuthoringKitFile("missing.txt")).toBeUndefined()
  })
})
