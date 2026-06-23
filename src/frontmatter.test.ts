import { describe, it, expect } from "vitest"
import { EditorState } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import {
  frontmatterRange,
  frontmatterYamlMarks,
  toggleFrontmatter,
  frontmatterRendering,
} from "./frontmatter"
import { ProgrammaticLoad } from "./editor-load"

// --- helpers -----------------------------------------------------------------

/** Pure detector: build a bare state and run the detector over it. */
const state = (doc: string) => EditorState.create({ doc })
const range = (doc: string) => frontmatterRange(state(doc))

/** Mount a real EditorView with the rendering extension, in happy-dom. */
const mount = (doc: string) =>
  new EditorView({
    state: EditorState.create({ doc, extensions: [frontmatterRendering] }),
    parent: document.createElement("div"),
  })

/** The rendered text the user actually sees in the editor content. */
const renderedText = (view: EditorView) =>
  view.contentDOM.textContent ?? ""

/** The clickable collapsed chip, if present. */
const chip = (view: EditorView) =>
  view.dom.querySelector(".cm-frontmatter-toggle")

const SAMPLE = "---\ntitle: Hello\ntags: [a, b]\n---\nbody text here\n"

// --- AC-1 / AC-2 / AC-3: pure detector --------------------------------------

describe("frontmatterRange (detector)", () => {
  it("AC-1: detects a leading closed block (--- close), range ends at close-line end", () => {
    const doc = "---\ntitle: Hello\n---\nbody\n"
    // closing `---` line ends just before its trailing newline.
    const closeLineEnd = doc.indexOf("---\nbody") + "---".length
    expect(range(doc)).toEqual({ from: 0, to: closeLineEnd })
  })

  it("AC-1: detects a leading closed block with a `...` closing delimiter", () => {
    const doc = "---\ntitle: Hello\n...\nbody\n"
    const closeLineEnd = doc.indexOf("...\nbody") + "...".length
    expect(range(doc)).toEqual({ from: 0, to: closeLineEnd })
  })

  it("AC-1: a closing delimiter on the last line (no trailing newline) ends at doc end", () => {
    const doc = "---\ntitle: Hello\n---"
    expect(range(doc)).toEqual({ from: 0, to: doc.length })
  })

  it("AC-2: a leading `---` with no closing delimiter is not frontmatter (null)", () => {
    expect(range("---\ntitle: Hello\nbody text\n")).toBeNull()
  })

  it("AC-3: a `---` that is not the first line is not frontmatter (null)", () => {
    expect(range("body text\n---\ntitle: Hello\n---\n")).toBeNull()
  })

  it("AC-2/AC-3: an empty document is not frontmatter (null)", () => {
    expect(range("")).toBeNull()
  })
})

// --- AC-4: collapsed by default ---------------------------------------------

describe("frontmatterRendering — collapsed (default)", () => {
  it("AC-4: shows a clickable metadata chip and hides the raw frontmatter lines", () => {
    const view = mount(SAMPLE)
    try {
      const toggle = chip(view)
      expect(toggle).not.toBeNull()
      expect((toggle?.textContent ?? "").toLowerCase()).toContain("metadata")

      const shown = renderedText(view)
      expect(shown).not.toContain("title: Hello")
      expect(shown).not.toContain("tags: [a, b]")
      // body still follows
      expect(shown).toContain("body text here")
    } finally {
      view.destroy()
    }
  })
})

// --- AC-5 / AC-6: expand & collapse via the toggle effect --------------------

describe("frontmatterRendering — toggle", () => {
  it("AC-5: dispatching toggleFrontmatter reveals the raw text including ---", () => {
    const view = mount(SAMPLE)
    try {
      view.dispatch({ effects: toggleFrontmatter.of() })

      const shown = renderedText(view)
      expect(shown).toContain("---")
      expect(shown).toContain("title: Hello")
      expect(shown).toContain("tags: [a, b]")

      // a collapse-header toggle control is present while expanded
      expect(chip(view)).not.toBeNull()
    } finally {
      view.destroy()
    }
  })

  it("AC-6: toggling again returns to the collapsed chip with raw lines hidden", () => {
    const view = mount(SAMPLE)
    try {
      view.dispatch({ effects: toggleFrontmatter.of() }) // expand
      view.dispatch({ effects: toggleFrontmatter.of() }) // collapse again

      const toggle = chip(view)
      expect(toggle).not.toBeNull()
      expect((toggle?.textContent ?? "").toLowerCase()).toContain("metadata")
      expect(renderedText(view)).not.toContain("title: Hello")
    } finally {
      view.destroy()
    }
  })
})

// --- AC-7: byte fidelity -----------------------------------------------------

describe("frontmatterRendering — byte fidelity (AC-7)", () => {
  it("AC-7: collapsed rendering does not change the document bytes", () => {
    const view = mount(SAMPLE)
    try {
      expect(view.state.doc.toString()).toBe(SAMPLE)
    } finally {
      view.destroy()
    }
  })

  it("AC-7: expanded rendering does not change the document bytes", () => {
    const view = mount(SAMPLE)
    try {
      view.dispatch({ effects: toggleFrontmatter.of() })
      expect(view.state.doc.toString()).toBe(SAMPLE)
    } finally {
      view.destroy()
    }
  })
})

// --- AC-8: caret atomicity (layout-dependent, deferred to e2e) ---------------

describe("frontmatterRendering — caret atomicity (AC-8)", () => {
  it.todo(
    "AC-8: caret stepping across the collapsed chip lands on the body side, never inside the hidden block (covered by Playwright e2e — layout-dependent, not assertable in happy-dom)",
  )
})

// --- AC-9: reset on programmatic load ---------------------------------------

describe("frontmatterRendering — reset on load (AC-9)", () => {
  it("AC-9: a ProgrammaticLoad doc replacement reopens frontmatter collapsed", () => {
    const view = mount(SAMPLE)
    try {
      // expand the current note's frontmatter
      view.dispatch({ effects: toggleFrontmatter.of() })
      expect(renderedText(view)).toContain("title: Hello")

      // load a different note (also with frontmatter) programmatically
      const next = "---\ntitle: Another\nfoo: bar\n---\nsecond note\n"
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: next },
        annotations: ProgrammaticLoad.of(true),
      })

      // it must render collapsed again
      const toggle = chip(view)
      expect(toggle).not.toBeNull()
      expect((toggle?.textContent ?? "").toLowerCase()).toContain("metadata")
      const shown = renderedText(view)
      expect(shown).not.toContain("title: Another")
      expect(shown).not.toContain("foo: bar")
      expect(shown).toContain("second note")
    } finally {
      view.destroy()
    }
  })
})

describe("frontmatterYamlMarks (FEAT-0050)", () => {
  const marks = (doc: string) => {
    const s = state(doc)
    const r = frontmatterRange(s)
    return r ? frontmatterYamlMarks(s, r) : []
  }

  it("AC-1: marks the inner YAML (a key and a comment) within the block", () => {
    const doc = '---\ntitle: "Hello"\n# a note\n---\n\nbody\n'
    const ms = marks(doc)
    expect(ms.length).toBeGreaterThan(0)
    // A key carries a propertyName token; the `#` line a comment token.
    expect(ms.some((m) => m.cls.includes("tok-propertyName"))).toBe(true)
    expect(ms.some((m) => m.cls.includes("tok-comment"))).toBe(true)
    // Every mark lands strictly inside the block (after the opening `---` line,
    // before the closing `---` line) — never over a delimiter.
    const innerFrom = doc.indexOf("\n") + 1
    const innerTo = doc.indexOf("\n---\n") // start of the closing delimiter line
    for (const m of ms) {
      expect(m.from).toBeGreaterThanOrEqual(innerFrom)
      expect(m.to).toBeLessThanOrEqual(innerTo)
    }
  })

  it("yields no marks for an empty-body block", () => {
    expect(marks("---\n---\n")).toEqual([])
  })

  it("AC-5: malformed YAML does not throw", () => {
    expect(() => marks("---\n: : :\n\t- broken\n---\n")).not.toThrow()
  })
})
