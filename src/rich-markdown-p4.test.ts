import { describe, expect, it } from "vitest"
import {
  editRawSource,
  editRichLink,
  editSpecialSource,
  editTableCell,
  importMarkdown,
  replaceVisible,
  serializeMarkdown,
  sourceEditRangeAt,
} from "./rich-markdown"

describe("rich Markdown P4 projection boundary", () => {
  it("projects link labels while preserving nested marks and source positions", () => {
    const source = "See [**bold** label](target.md) and [[note|Alias]]"
    const document = importMarkdown(source)
    expect(document.visible).toBe("See bold label and Alias")
    expect(document.links).toHaveLength(2)
    expect(document.links[0]).toMatchObject({ kind: "markdown", target: "target.md", label: "**bold** label" })
    expect(document.links[1]).toMatchObject({ kind: "wikilink", target: "note", label: "Alias" })
    expect(document.ranges.some((range) => range.link?.kind === "markdown" && range.marks.includes("bold"))).toBe(true)
    expect(serializeMarkdown(document)).toBe(source)
  })

  it("keeps special source islands raw and never parses their bodies", () => {
    const source = "---\ntitle: **raw**\n---\n```js\n**raw** [x](inside.md)\n```\n| [cell](inside.md) |\n| --- |\noutside [x](ok.md)"
    const document = importMarkdown(source)
    expect(document.visible).toBe(source.replace("outside [x](ok.md)", "outside x"))
    expect(document.specials.map((special) => special.kind)).toEqual(["frontmatter", "fence", "table"])
    expect(document.links.map((link) => link.target)).toEqual(["ok.md"])
    expect(document.ranges.filter((range) => range.special).every((range) => range.block !== "paragraph")).toBe(true)
    expect(serializeMarkdown(document)).toBe(source)
    const fence = document.specials.find((special) => special.kind === "fence")!
    expect(() => replaceVisible(document, fence.sourceFrom, fence.sourceFrom + 3, "raw")).toThrow(RangeError)
  })

  it("edits only an explicitly selected link label or target", () => {
    const source = "before [label](old.md) after [[old|Alias]]"
    const document = importMarkdown(source)
    const markdown = document.links.find((link) => link.kind === "markdown")!
    const targetChanged = editRichLink(document, markdown, { target: "new.md#part" })
    expect(targetChanged).not.toBeNull()
    expect(serializeMarkdown(targetChanged!)).toBe("before [label](new.md#part) after [[old|Alias]]")

    const wiki = targetChanged!.links.find((link) => link.kind === "wikilink")!
    const labelChanged = editRichLink(targetChanged!, wiki, { label: "New alias" })
    expect(serializeMarkdown(labelChanged!)).toBe("before [label](new.md#part) after [[old|New alias]]")
    expect(editRichLink(targetChanged!, markdown, { target: "stale.md" })).toBeNull()
  })

  it("edits one table cell without normalizing pipes, spacing, or line endings", () => {
    const source = "| A | B \\| C |\r\n| --- | --- |\r\n| one | two |"
    const document = importMarkdown(source)
    const table = document.specials.find((special) => special.kind === "table")!
    const cell = table.kind === "table" ? table.rows[2]!.cells[1]! : null
    expect(cell).not.toBeNull()
    const edited = editTableCell(document, cell!, "changed")
    expect(serializeMarkdown(edited!)).toBe("| A | B \\| C |\r\n| --- | --- |\r\n| one | changed |")
    expect(editTableCell(document, { ...cell!, text: "stale" }, "no")).toBeNull()
  })

  it("routes raw source positions to deliberate edit ranges", () => {
    const source = "[label](target.md)\n```mermaid\ngraph TD\n```\n| a | b |\n| --- | --- |\n| c | d |"
    const document = importMarkdown(source)
    const link = document.links[0]!
    expect(sourceEditRangeAt(document, link.targetFrom)?.kind).toBe("link-target")
    const mermaid = document.specials.find((special) => special.kind === "mermaid")!
    expect(sourceEditRangeAt(document, mermaid.sourceFrom + 2)?.kind).toBe("mermaid")
    const table = document.specials.find((special) => special.kind === "table")!
    const tableCell = table.kind === "table" ? table.rows[2]!.cells[1]! : null
    expect(sourceEditRangeAt(document, tableCell!.contentFrom)?.kind).toBe("table-cell")
    expect(sourceEditRangeAt(document, source.length)).toBeNull()
  })

  it("edits complete special blocks or malformed raw ranges explicitly", () => {
    const source = "```js\nold\n```\nplain [open]("
    const document = importMarkdown(source)
    const fence = document.specials[0]!
    const changed = editSpecialSource(document, fence, "```ts\nnew\n```")
    expect(serializeMarkdown(changed!)).toBe("```ts\nnew\n```\nplain [open](")
    expect(editSpecialSource(document, { ...fence, raw: "stale" }, "x")).toBeNull()
    const rawFrom = changed!.source.indexOf("[open]")
    const repaired = editRawSource(changed!, rawFrom, changed!.source.length, "[open](done.md)")
    expect(serializeMarkdown(repaired!)).toBe("```ts\nnew\n```\nplain [open](done.md)")
  })

  it("preserves UTF-16 mappings and bytes around adjacent special nodes", () => {
    const source = "---\r\ntitle: keep\r\n---\r\n😀 [café](n.md)\r\nnext"
    const document = importMarkdown(source)
    expect(document.visible).toBe("---\r\ntitle: keep\r\n---\r\n😀 café\r\nnext")
    expect(serializeMarkdown(document)).toBe(source)
    expect(document.links[0]!.label).toBe("café")
    expect(document.specials[0]!.kind).toBe("frontmatter")
    expect(sourceEditRangeAt(document, document.specials[0]!.sourceFrom + 4)?.kind).toBe("frontmatter")
  })
})
