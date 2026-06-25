import { describe, it, expect } from "vitest"
import { EditorState } from "@codemirror/state"
import { markdown } from "@codemirror/lang-markdown"
import { ensureSyntaxTree } from "@codemirror/language"
import {
  findMermaidBlocks,
  mermaidDecorations,
  MermaidWidget,
  type MermaidBlock,
} from "./mermaid-render"

// FEAT-0056 — UNIT tests for the Mermaid renderer's CONTRACT (happy-dom).
//
// `findMermaidBlocks` walks the Lezer markdown syntax tree, so the state MUST be
// built with the `markdown()` extension (exactly as markdown-render.test.ts and
// code-highlight.test.ts do) — a bare state has no tree. We additionally force the
// tree to be fully parsed up front with `ensureSyntaxTree`, so the walk sees the
// whole document deterministically regardless of the incremental parser's budget.
//
// These tests assert on observable behaviour only: the blocks returned, and the
// DecorationSet's size and the ranges it yields. No private-state / widget-internal
// assertions. They do NOT call `renderMermaid` or `toDOM` (real Mermaid render needs
// a real browser — covered by e2e, out of scope here).

/** Build a state whose markdown syntax tree is fully populated. */
const state = (doc: string, selection?: { anchor: number; head?: number }) => {
  const s = EditorState.create({
    doc,
    ...(selection ? { selection } : {}),
    extensions: [markdown()],
  })
  // Force a COMPLETE parse over the whole doc, deterministically. The budget is huge
  // so the incremental parser never bails mid-parse on a wall-clock check (it finishes
  // a tiny doc in a single pass well under it) — a small budget could return a partial
  // tree under heavy parallel-test CPU load and flake the block scan.
  ensureSyntaxTree(s, doc.length, 1e9)
  return s
}

const blocks = (doc: string, selection?: { anchor: number; head?: number }) =>
  findMermaidBlocks(state(doc, selection))

/** The exact source strings of the found blocks, for readable assertions. */
const sources = (b: MermaidBlock[]) => b.map((x) => x.source)

/** The [from, to] ranges yielded by a DecorationSet, in document order. */
const decoRanges = (set: ReturnType<typeof mermaidDecorations>) => {
  const out: Array<[number, number]> = []
  set.between(0, Number.MAX_SAFE_INTEGER, (from, to) => {
    out.push([from, to])
  })
  return out
}

// --- AC-1: findMermaidBlocks (the pure scanner) ------------------------------

describe("findMermaidBlocks (FEAT-0056 AC-1)", () => {
  it("returns one block for a single closed ```mermaid fence, source stripped of fences", () => {
    const doc = "```mermaid\nflowchart TD\n  A --> B\n```\n"
    const found = blocks(doc)
    expect(found).toHaveLength(1)
    // Source is the diagram text WITHOUT the fence lines.
    expect(found[0].source).toBe("flowchart TD\n  A --> B")
    expect(found[0].source).not.toContain("```")
    // from/to span the whole block, fence line to fence line.
    expect(doc.slice(found[0].from, found[0].to)).toBe("```mermaid\nflowchart TD\n  A --> B\n```")
  })

  it("does not return a ```js block (different info string)", () => {
    expect(blocks("```js\ncode\n```\n")).toEqual([])
  })

  it("does not return a bare ``` block with no info string", () => {
    expect(blocks("```\nplain\n```\n")).toEqual([])
  })

  it("does not return an unterminated ```mermaid fence (no closing ```)", () => {
    expect(blocks("```mermaid\nflowchart TD\n  A --> B\n")).toEqual([])
  })

  it("returns two blocks in document order for two mermaid fences", () => {
    const doc = "```mermaid\nA\n```\n\n```mermaid\nB\n```\n"
    const found = blocks(doc)
    expect(found).toHaveLength(2)
    expect(sources(found)).toEqual(["A", "B"])
    // document order: the first block precedes the second.
    expect(found[0].from).toBeLessThan(found[1].from)
  })

  it("returns only the block when surrounded by prose", () => {
    const doc = "Some intro prose.\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\nTrailing prose.\n"
    const found = blocks(doc)
    expect(found).toHaveLength(1)
    expect(found[0].source).toBe("flowchart TD\n  A --> B")
    // the span covers exactly the fenced block, no prose.
    expect(doc.slice(found[0].from, found[0].to)).toBe("```mermaid\nflowchart TD\n  A --> B\n```")
  })
})

// --- AC-1: mermaidDecorations (reveal-on-selection) --------------------------

describe("mermaidDecorations (FEAT-0056 AC-1)", () => {
  it("replaces each block when the selection is outside all blocks", () => {
    const doc = "prose\n\n```mermaid\nflowchart TD\n  A --> B\n```\nafter\n"
    const found = findMermaidBlocks(state(doc))
    expect(found).toHaveLength(1)
    // caret at the very start, outside the block.
    const set = mermaidDecorations(state(doc, { anchor: 0 }))
    expect(set.size).toBe(1)
    expect(decoRanges(set)).toEqual([[found[0].from, found[0].to]])
  })

  it("omits the block whose range the selection is inside (revealed)", () => {
    const doc = "```mermaid\nflowchart TD\n  A --> B\n```\n"
    const found = findMermaidBlocks(state(doc))
    // place the caret inside the diagram body.
    const inside = Math.floor((found[0].from + found[0].to) / 2)
    const set = mermaidDecorations(state(doc, { anchor: inside }))
    expect(set.size).toBe(0)
    expect(decoRanges(set)).toEqual([])
  })

  it("keeps the other block decorated when the selection is in one of two blocks", () => {
    const doc = "```mermaid\nA\n```\n\n```mermaid\nB\n```\n"
    const found = findMermaidBlocks(state(doc))
    expect(found).toHaveLength(2)
    // caret inside the FIRST block.
    const inFirst = Math.floor((found[0].from + found[0].to) / 2)
    const set = mermaidDecorations(state(doc, { anchor: inFirst }))
    // only the second block stays decorated.
    expect(set.size).toBe(1)
    expect(decoRanges(set)).toEqual([[found[1].from, found[1].to]])
  })
})

// --- AC-3: MermaidWidget.eq --------------------------------------------------

describe("MermaidWidget.eq (FEAT-0056 AC-3)", () => {
  it("is true for equal source", () => {
    expect(new MermaidWidget("a").eq(new MermaidWidget("a"))).toBe(true)
  })

  it("is false for differing source", () => {
    expect(new MermaidWidget("a").eq(new MermaidWidget("b"))).toBe(false)
  })
})
