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
    expect(AUTHORING_KIT_VERSION).toBe("1.3.0")
    const files = listAuthoringKitFiles()
    expect(files.map((file) => file.path)).toEqual([
      "template/manifest.json",
      "template/main.js",
      "brulion-extension.d.ts",
      "api-contract.json",
      "examples/hello-world/manifest.json",
      "examples/hello-world/main.js",
      "examples/open-journal/manifest.json",
      "examples/open-journal/main.js",
      "examples/resolve-and-open/manifest.json",
      "examples/resolve-and-open/main.js",
      "examples/selection-feedback/manifest.json",
      "examples/selection-feedback/main.js",
      "examples/dialog-lifecycle/manifest.json",
      "examples/dialog-lifecycle/main.js",
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
    expect(getAuthoringKitFile("api-contract.json")?.content).toContain('"apiVersion": 1')
    expect(source).not.toMatch(/from\s+["']https?:|setInterval|setTimeout|npm install|\.ts\b/)
    const bundle = serializeAuthoringKit()
    expect(bundle.indexOf("===== template/manifest.json =====")).toBeLessThan(
      bundle.indexOf("===== template/main.js ====="),
    )
    expect(getAuthoringKitFile("missing.txt")).toBeUndefined()
  })

  it("ships least-privilege interaction examples without host escape hatches", () => {
    const selectionManifest = JSON.parse(getAuthoringKitFile("examples/selection-feedback/manifest.json")!.content)
    const selectionSource = getAuthoringKitFile("examples/selection-feedback/main.js")!.content
    const dialogManifest = JSON.parse(getAuthoringKitFile("examples/dialog-lifecycle/manifest.json")!.content)
    const dialogSource = getAuthoringKitFile("examples/dialog-lifecycle/main.js")!.content

    expect(selectionManifest.permissions).toEqual(["commands", "editor:read", "editor:selection", "notifications"])
    expect(dialogManifest.permissions).toEqual(["commands", "dialogs"])
    expect(selectionSource).toContain("api.editor.getSelection")
    expect(selectionSource).toContain("api.editor.setSelection")
    expect(selectionSource).toContain("api.notifications.show")
    expect(dialogSource).toContain("api.dialogs.alert")
    expect(dialogSource).toContain("api.dialogs.confirm")
    expect(dialogSource).toContain("api.dialogs.prompt")
    expect(dialogSource).toContain('error.code === "timeout"')
    for (const source of [selectionSource, dialogSource]) {
      expect(source).not.toMatch(/document\.|window\.|navigator\.|showDirectoryPicker|fetch\(|https?:\/\//)
      expect(source).not.toMatch(/set(?:Timeout|Interval)\s*\(/)
    }
    expect(selectionManifest.permissions).not.toContain("editor:write")
    expect(dialogManifest.permissions).not.toContain("notifications")
  })

  it("ships least-privilege navigation examples without host escape hatches", () => {
    const journalManifest = JSON.parse(getAuthoringKitFile("examples/open-journal/manifest.json")!.content)
    const journalSource = getAuthoringKitFile("examples/open-journal/main.js")!.content
    const resolveManifest = JSON.parse(getAuthoringKitFile("examples/resolve-and-open/manifest.json")!.content)
    const resolveSource = getAuthoringKitFile("examples/resolve-and-open/main.js")!.content

    expect(journalManifest.permissions).toEqual(["commands", "navigation:write"])
    expect(resolveManifest.permissions).toEqual(["commands", "navigation:read", "navigation:write"])
    expect(journalSource).toContain('result.status === "conflict"')
    expect(resolveSource).toContain('link.status === "missing"')
    expect(resolveSource).toContain("api.navigation.openNote")
    for (const source of [journalSource, resolveSource]) {
      expect(source).not.toMatch(/document\.|window\.|navigator\.|showDirectoryPicker|fetch\(|https?:\/\//)
      expect(source).not.toContain("api.notes.create")
    }
  })
})
