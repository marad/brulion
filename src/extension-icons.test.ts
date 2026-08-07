import { describe, expect, it } from "vitest"
import { Braces, Puzzle, Sparkles, Terminal } from "lucide"
import {
  DEFAULT_EXTENSION_ICON_NAME,
  resolveExtensionIcon,
  sanitizeExtensionIconName,
} from "./extension-icons"

describe("extension command icons", () => {
  it("maps allowlisted names to bundled Lucide nodes", () => {
    expect(resolveExtensionIcon("sparkles")).toBe(Sparkles)
    expect(resolveExtensionIcon("terminal")).toBe(Terminal)
    expect(resolveExtensionIcon("braces")).toBe(Braces)
  })

  it("defaults missing, blank, unknown, and markup values to puzzle", () => {
    expect(DEFAULT_EXTENSION_ICON_NAME).toBe("puzzle")
    for (const value of [undefined, "", "does-not-exist", "<svg></svg>", "sparkles()"]) {
      expect(sanitizeExtensionIconName(value)).toBe("puzzle")
      expect(resolveExtensionIcon(value)).toBe(Puzzle)
    }
  })
})
