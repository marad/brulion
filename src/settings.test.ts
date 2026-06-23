import { describe, it, expect } from "vitest"
import {
  normalizeSettings,
  buildFontStack,
  loadSettings,
  saveSettings,
  applySettings,
  DEFAULT_SETTINGS,
  SETTINGS_FILE,
  type Settings,
} from "./settings"
import { mountEditor } from "./editor"

// --- Minimal in-memory mock dir, in the same style as note.test.ts/fs.test.ts ---
// A single flat folder is all settings needs: it reads/writes one file at root.

type FileNode = { content: string }

function notFound(): never {
  throw new DOMException("not found", "NotFoundError")
}

/** A fake root directory handle backing a flat map of files. Supports just the
 * surface settings touches: getFileHandle (with `{ create }`), getFile().text(),
 * and createWritable()/write()/close(). */
function fakeFolder(initial: Record<string, string> = {}) {
  const files = new Map<string, FileNode>()
  for (const [name, content] of Object.entries(initial)) files.set(name, { content })

  const fileHandleFor = (fname: string) => ({
    kind: "file" as const,
    name: fname,
    getFile: async () => {
      const e = files.get(fname)!
      return { text: async () => e.content }
    },
    createWritable: async () => {
      let buf = ""
      return {
        write: async (data: unknown) => {
          buf += String(data)
        },
        close: async () => {
          files.set(fname, { content: buf })
        },
      }
    },
  })

  const dir = {
    kind: "directory" as const,
    name: "",
    getFileHandle: async (fname: string, options?: { create?: boolean }) => {
      const e = files.get(fname)
      if (!e && !options?.create) notFound()
      if (!e && options?.create) files.set(fname, { content: "" })
      return fileHandleFor(fname)
    },
  }

  return {
    dir: dir as unknown as FileSystemDirectoryHandle,
    content: (name: string) => files.get(name)?.content ?? null,
    has: (name: string) => files.has(name),
  }
}

describe("normalizeSettings (AC-3)", () => {
  it("AC-3: clamps textSize above MAX_SIZE to 24", () => {
    expect(normalizeSettings({ textSize: 99 }).textSize).toBe(24)
  })

  it("AC-3: clamps textSize below MIN_SIZE to 12", () => {
    expect(normalizeSettings({ textSize: 3 }).textSize).toBe(12)
  })

  it("AC-3: rounds a fractional textSize", () => {
    expect(normalizeSettings({ textSize: 17.4 }).textSize).toBe(17)
    expect(normalizeSettings({ textSize: 17.6 }).textSize).toBe(18)
  })

  it("AC-3: falls back to 16 for NaN, missing, or non-number textSize", () => {
    expect(normalizeSettings({ textSize: NaN }).textSize).toBe(16)
    expect(normalizeSettings({}).textSize).toBe(16)
    expect(normalizeSettings({ textSize: "20" }).textSize).toBe(16)
  })

  it("AC-3: keeps the three valid editorWidth literals", () => {
    expect(normalizeSettings({ editorWidth: "narrow" }).editorWidth).toBe("narrow")
    expect(normalizeSettings({ editorWidth: "wider" }).editorWidth).toBe("wider")
    expect(normalizeSettings({ editorWidth: "full" }).editorWidth).toBe("full")
  })

  it("AC-3: falls back to narrow for an unknown or missing editorWidth", () => {
    expect(normalizeSettings({ editorWidth: "huge" }).editorWidth).toBe("narrow")
    expect(normalizeSettings({}).editorWidth).toBe("narrow")
  })

  it("AC-3: yields [] for a non-array font", () => {
    expect(normalizeSettings({ font: "Menlo" }).font).toEqual([])
    expect(normalizeSettings({}).font).toEqual([])
  })

  it("AC-3: keeps only string entries of a font array", () => {
    expect(
      normalizeSettings({ font: ["Menlo", 12, { x: 1 }, null, "Courier New"] }).font,
    ).toEqual(["Menlo", "Courier New"])
  })

  it("AC-3: coerces vim to a boolean", () => {
    expect(normalizeSettings({ vim: 1 }).vim).toBe(true)
    expect(normalizeSettings({ vim: 0 }).vim).toBe(false)
    expect(normalizeSettings({ vim: "" }).vim).toBe(false)
    expect(normalizeSettings({}).vim).toBe(false)
  })

  it("AC-3: returns the defaults for a non-object input", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings("nope")).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings(42)).toEqual(DEFAULT_SETTINGS)
  })

  it("AC-3: never throws and does not mutate its argument", () => {
    const raw = { textSize: 99, editorWidth: "bogus", font: ["A", 1], vim: 1 }
    const before = JSON.parse(JSON.stringify(raw))
    expect(() => normalizeSettings(raw)).not.toThrow()
    expect(raw).toEqual(before)
  })
})

describe("buildFontStack (AC-4)", () => {
  it("AC-4: quotes a multi-word family, leaves a single-word family bare", () => {
    expect(buildFontStack(["Courier New"])).toBe('"Courier New", sans-serif')
    expect(buildFontStack(["Menlo"])).toBe("Menlo, sans-serif")
  })

  it("AC-4: preserves order and appends the generic floor last", () => {
    expect(buildFontStack(["Menlo", "Courier New"])).toBe(
      'Menlo, "Courier New", sans-serif',
    )
  })

  it("AC-4: yields just the generic floor for an empty list", () => {
    expect(buildFontStack([])).toBe("sans-serif")
  })
})

describe("loadSettings / saveSettings round-trip (AC-5, AC-2)", () => {
  it("AC-5: a saved non-default settings value round-trips, via .brulion.json at root", async () => {
    const folder = fakeFolder()
    const settings: Settings = {
      font: ["Menlo", "Courier New"],
      textSize: 20,
      editorWidth: "wider",
      vim: true,
    }
    await saveSettings(folder.dir, settings)
    expect(folder.has(SETTINGS_FILE)).toBe(true)
    expect(SETTINGS_FILE).toBe(".brulion.json")
    expect(await loadSettings(folder.dir)).toEqual(settings)
  })

  it("AC-5: a folder with no .brulion.json loads the defaults", async () => {
    const folder = fakeFolder()
    expect(await loadSettings(folder.dir)).toEqual(DEFAULT_SETTINGS)
  })

  it("AC-5: invalid JSON loads the defaults without throwing", async () => {
    const folder = fakeFolder({ [SETTINGS_FILE]: "{ not: valid json ]" })
    expect(await loadSettings(folder.dir)).toEqual(DEFAULT_SETTINGS)
  })

  it("AC-5: valid JSON with garbage values is normalized on load", async () => {
    const folder = fakeFolder({
      [SETTINGS_FILE]: JSON.stringify({
        textSize: 999,
        editorWidth: "ginormous",
        font: ["Menlo", 7],
        vim: "yes",
      }),
    })
    expect(await loadSettings(folder.dir)).toEqual({
      font: ["Menlo"],
      textSize: 24,
      editorWidth: "narrow",
      vim: true,
    })
  })
})

describe("applySettings DOM variables", () => {
  it("sets --editor-font-size and --editor-measure on the given root", () => {
    const view = mountEditor(document.createElement("div"))
    const root = document.createElement("div")
    try {
      applySettings(
        view,
        { font: [], textSize: 20, editorWidth: "wider", vim: false },
        root,
      )
      expect(root.style.getPropertyValue("--editor-font-size")).toBe("20px")
      expect(root.style.getPropertyValue("--editor-measure")).toBe("90ch")
    } finally {
      view.destroy()
    }
  })

  it("maps narrow and full editorWidth to their measures", () => {
    const view = mountEditor(document.createElement("div"))
    try {
      const narrowRoot = document.createElement("div")
      applySettings(view, { ...DEFAULT_SETTINGS, editorWidth: "narrow" }, narrowRoot)
      expect(narrowRoot.style.getPropertyValue("--editor-measure")).toBe("68ch")

      const fullRoot = document.createElement("div")
      applySettings(view, { ...DEFAULT_SETTINGS, editorWidth: "full" }, fullRoot)
      expect(fullRoot.style.getPropertyValue("--editor-measure")).toBe("none")
    } finally {
      view.destroy()
    }
  })

  it("sets --font-stack from a non-empty font list", () => {
    const view = mountEditor(document.createElement("div"))
    const root = document.createElement("div")
    try {
      applySettings(
        view,
        { font: ["Menlo", "Courier New"], textSize: 16, editorWidth: "narrow", vim: false },
        root,
      )
      expect(root.style.getPropertyValue("--font-stack")).toBe(
        buildFontStack(["Menlo", "Courier New"]),
      )
    } finally {
      view.destroy()
    }
  })

  it("leaves no inline --font-stack when the font list is empty", () => {
    const view = mountEditor(document.createElement("div"))
    const root = document.createElement("div")
    try {
      applySettings(view, { ...DEFAULT_SETTINGS, font: [] }, root)
      expect(root.style.getPropertyValue("--font-stack")).toBe("")
    } finally {
      view.destroy()
    }
  })

  it("toggling Vim off then on does not throw on a real view", () => {
    const view = mountEditor(document.createElement("div"))
    const root = document.createElement("div")
    try {
      expect(() =>
        applySettings(view, { ...DEFAULT_SETTINGS, vim: false }, root),
      ).not.toThrow()
      expect(() =>
        applySettings(view, { ...DEFAULT_SETTINGS, vim: true }, root),
      ).not.toThrow()
    } finally {
      view.destroy()
    }
  })
})
