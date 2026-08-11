import { describe, expect, it } from "vitest"
import contractSource from "../extension-kit/api-contract.json?raw"
import declarations from "../extension-kit/brulion-extension.d.ts?raw"
import apiReference from "../extension-kit/API.md?raw"
import { EXTENSION_API_METHODS } from "./extension-host"
import { AUTHORING_KIT_VERSION } from "./authoring-kit"
import { SCRIPT_PERMISSIONS } from "./script-manifest"
import {
  contractMethods,
  parseExtensionApiContract,
} from "./extension-api-contract"

const expectedMethodIds = [
  "commands.register",
  "commands.unregister",
  "editor.getText",
  "editor.getSelection",
  "editor.replaceSelection",
  "editor.focus",
  "notes.list",
  "notes.read",
  "notes.create",
  "notes.write",
  "notes.delete",
  "notes.move",
  "navigation.getActiveNote",
  "navigation.openNote",
  "navigation.resolveLink",
]

describe("versioned extension API contract", () => {
  it("describes the complete v1 public surface", () => {
    const contract = parseExtensionApiContract(contractSource)
    expect(contract.kind).toBe("brulion.extension-api")
    expect(contract.apiVersion).toBe(1)
    expect(contract.kitVersion).toBe(AUTHORING_KIT_VERSION)
    expect(contract.manifest.fields.map((field) => field.name)).toEqual([
      "schemaVersion",
      "apiVersion",
      "id",
      "name",
      "version",
      "entry",
      "permissions",
    ])
    expect(contract.permissions.map((permission) => permission.id)).toEqual([
      "commands",
      "editor:read",
      "editor:write",
      "notes:read",
      "notes:write",
      "navigation:read",
      "navigation:write",
    ])
    expect([...SCRIPT_PERMISSIONS]).toEqual(contract.permissions.map((permission) => permission.id))
    const methods = contractMethods(contract)
    expect(methods.map((method) => method.id)).toEqual(expectedMethodIds)
    expect([...EXTENSION_API_METHODS]).toEqual(expectedMethodIds)
    expect(
      methods
        .filter((method) => method.id.startsWith("navigation."))
        .map(({ id, permission, returns }) => ({ id, permission, returns })),
    ).toEqual([
      { id: "navigation.getActiveNote", permission: "navigation:read", returns: "ActiveNote | null" },
      { id: "navigation.openNote", permission: "navigation:write", returns: "OpenNoteResult" },
      { id: "navigation.resolveLink", permission: "navigation:read", returns: "LinkResolution" },
    ])
    for (const type of contract.types) expect(declarations).toContain(type.declaration)
    expect(declarations).toContain("export type ExtensionIconName = string")
    expect(declarations).toContain("interface ActiveNote")
    expect(declarations).toContain("interface OpenNoteOptions")
    expect(declarations).toContain("type OpenNoteResult")
    expect(declarations).toContain("interface ResolveLinkOptions")
    expect(declarations).toContain("type LinkResolution")
    expect(apiReference).toContain("brulion.navigation")
    expect(apiReference).toContain("getActiveNote()")
    expect(apiReference).toContain("api.navigation.openNote")
    expect(apiReference).toContain("api.navigation.resolveLink")
    expect(apiReference).toContain("navigation:read")
    expect(apiReference).toContain("navigation:write")
    expect(apiReference).toContain("never implicitly creates or mutates")
    expect(declarations).not.toContain('export type ExtensionIconName = "braces"')
  })

  it("requires concrete method results in the authoring declaration", () => {
    const contract = parseExtensionApiContract(contractSource)
    for (const method of contractMethods(contract)) {
      expect(declarations).toContain(method.name + "(")
    }
    expect(declarations).toContain("Promise<RegisterResult>")
    expect(declarations).toContain("Promise<CreateResult>")
    expect(declarations).toContain("Promise<SaveResult>")
    expect(declarations).toContain("Promise<MoveResult>")
  })

  it("rejects malformed contracts instead of rendering a partial reference", () => {
    expect(() => parseExtensionApiContract("not json")).toThrow("not valid JSON")
    const broken = JSON.parse(contractSource) as {
      namespaces: Array<{ methods: Array<{ permission: string }> }>
    }
    broken.namespaces[0].methods[0].permission = "missing"
    expect(() => parseExtensionApiContract(JSON.stringify(broken))).toThrow("Unknown permission")
  })
})
