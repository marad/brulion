import { describe, expect, it } from "vitest"
import {
  parseScriptManifest,
  parseScriptManifestText,
  validateScriptFilePath,
  validateScriptEntry,
  validateScriptId,
  type ScriptManifest,
} from "./script-manifest"

const valid: ScriptManifest = {
  schemaVersion: 1,
  apiVersion: 1,
  id: "daily-tools",
  name: "Daily tools",
  version: "0.1.0",
  entry: "main.js",
  permissions: ["commands", "editor:read"],
}

describe("script manifest validation (FEAT-0082)", () => {
  it("accepts a valid v1 manifest and returns a detached value", () => {
    const raw = { ...valid, permissions: [...valid.permissions] }
    const result = parseScriptManifest(raw)

    expect(result).toEqual({ ok: true, manifest: valid })
    if (result.ok) expect(result.manifest).not.toBe(raw)
  })

  it("rejects wrong schema/API versions and malformed required fields", () => {
    expect(parseScriptManifest({ ...valid, schemaVersion: 2 })).toMatchObject({ ok: false })
    expect(parseScriptManifest({ ...valid, apiVersion: 0 })).toMatchObject({ ok: false })
    expect(parseScriptManifest({ ...valid, name: "   " })).toMatchObject({ ok: false })
    expect(parseScriptManifest({ ...valid, version: "1.0" })).toMatchObject({ ok: false })
    expect(parseScriptManifest({ ...valid, permissions: "commands" })).toMatchObject({ ok: false })
  })

  it("rejects duplicate and unknown permissions", () => {
    expect(parseScriptManifest({ ...valid, permissions: ["commands", "commands"] })).toMatchObject({
      ok: false,
    })
    expect(parseScriptManifest({ ...valid, permissions: ["network"] })).toMatchObject({ ok: false })
  })

  it("rejects traversal, absolute, unsafe, and non-JavaScript entry paths", () => {
    for (const id of ["", ".", "../escape", "Bad ID", "a/b", "a\\b", "-leading"]) {
      expect(validateScriptId(id).ok, id).toBe(false)
    }
    for (const entry of ["", "/main.js", "../main.js", "lib/../../main.js", "main.ts", "lib\\main.js", "a//b.js"]) {
      expect(validateScriptEntry(entry).ok, entry).toBe(false)
    }
    expect(parseScriptManifest({ ...valid, entry: "../main.js" })).toMatchObject({ ok: false })
  })

  it("accepts nested JavaScript entry paths and semver prereleases", () => {
    expect(validateScriptEntry("lib/tools.main.js")).toEqual({ ok: true, value: "lib/tools.main.js" })
    expect(
      parseScriptManifest({ ...valid, version: "1.2.3-beta.1+build.7", entry: "src/main.js" }),
    ).toMatchObject({ ok: true })
  })

  it("parses JSON text without letting malformed JSON escape", () => {
    expect(parseScriptManifestText(JSON.stringify(valid))).toMatchObject({ ok: true, manifest: valid })
    expect(parseScriptManifestText("{not json")).toMatchObject({ ok: false })
  })

  it("accepts only safe JavaScript and JSON companion paths", () => {
    for (const path of ["manifest.json", "main.js", "lib/helpers.js", "data/config.json"]) {
      expect(validateScriptFilePath(path), path).toEqual({ ok: true, value: path })
    }
    for (const path of ["", "/main.js", "../main.js", "lib/../../x.js", "lib/helper.ts", "lib\\helper.js", "main.css", "a//b.js"]) {
      expect(validateScriptFilePath(path).ok, path).toBe(false)
    }
  })
})
