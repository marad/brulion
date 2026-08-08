import { describe, expect, it } from "vitest"
import contractSource from "../extension-kit/api-contract.json?raw"
import declarations from "../extension-kit/brulion-extension.d.ts?raw"
import { EXTENSION_API_METHODS } from "./extension-host"
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
]

describe("versioned extension API contract", () => {
  it("describes the complete v1 public surface", () => {
    const contract = parseExtensionApiContract(contractSource)
    expect(contract.kind).toBe("brulion.extension-api")
    expect(contract.apiVersion).toBe(1)
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
    ])
    expect(contractMethods(contract).map((method) => method.id)).toEqual(expectedMethodIds)
    expect([...EXTENSION_API_METHODS]).toEqual(expectedMethodIds)
    for (const type of contract.types) expect(declarations).toContain(type.declaration)
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
