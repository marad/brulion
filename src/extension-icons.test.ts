import { describe, expect, it } from "vitest"
import { Heart, HeartPulse, Puzzle, Sparkles, Terminal } from "lucide"
import {
  DEFAULT_EXTENSION_ICON_NAME,
  resolveExtensionIcon,
  sanitizeExtensionIconName,
} from "./extension-icons"

describe("extension command icons", () => {
  it("resolves arbitrary names from the bundled Lucide catalog", () => {
    expect(resolveExtensionIcon("sparkles")).toBe(Sparkles)
    expect(resolveExtensionIcon("terminal")).toBe(Terminal)
    expect(resolveExtensionIcon("heart")).toBe(Heart)
    expect(resolveExtensionIcon("heart-pulse")).toBe(HeartPulse)
    expect(resolveExtensionIcon("HeartPulse")).toBe(HeartPulse)
  })

  it("accepts arbitrary non-blank metadata while falling back safely", () => {
    expect(DEFAULT_EXTENSION_ICON_NAME).toBe("puzzle")
    expect(sanitizeExtensionIconName("custom-extension-icon")).toBe("custom-extension-icon")
    expect(sanitizeExtensionIconName("<svg></svg>")).toBe("<svg></svg>")
    expect(resolveExtensionIcon("does-not-exist")).toBe(Puzzle)
    expect(resolveExtensionIcon("<svg></svg>")).toBe(Puzzle)
    for (const value of [undefined, "", "   "]) {
      expect(sanitizeExtensionIconName(value)).toBe("puzzle")
      expect(resolveExtensionIcon(value)).toBe(Puzzle)
    }
  })
})
