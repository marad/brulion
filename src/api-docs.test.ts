import { describe, expect, it } from "vitest"
import apiHtml from "../api.html?raw"
import apiReference from "../extension-kit/API.md?raw"
import contractSource from "../extension-kit/api-contract.json?raw"
import { contractMethods, parseExtensionApiContract } from "./extension-api-contract"

describe("extension API documentation surface", () => {
  it("contains the navigable reference mounts and direct-open controls", () => {
    expect(apiHtml).toContain('id="api-docs-search"')
    expect(apiHtml).toContain('id="api-docs-toc"')
    expect(apiHtml).toContain('id="api-docs-reference"')
    expect(apiHtml).toContain('id="api-docs-contract"')
    expect(apiHtml).toContain('href="workbench.html"')
  })

  it("keeps the human guide focused on safe, file-faithful authoring", () => {
    expect(apiReference).toContain("## Start here")
    expect(apiReference).toContain("## Safe note update")
    expect(apiReference).toContain("expectedLastModified")
    expect(apiReference).toContain("## File fidelity")
  })

  it("has a method card contract for every public capability", () => {
    const contract = parseExtensionApiContract(contractSource)
    for (const method of contractMethods(contract)) {
      expect(method.example).not.toBe("")
      expect(method.permission).not.toBe("")
      expect(method.returns).not.toBe("")
    }
  })
})
