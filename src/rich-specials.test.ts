import { describe, expect, it } from "vitest"
import {
  scanRichLinks,
  scanRichSpecials,
  type RichSpecialNode,
} from "./rich-specials"

describe("rich Markdown special scanner", () => {
  it("records complete fences exactly and protects their body", () => {
    const source = "before\r\n  ```TS  \r\n**raw** [[not-a-link]]\r\n  ```\r\nafter"
    const scan = scanRichSpecials(source)
    expect(scan.specials).toHaveLength(1)
    const fence = scan.specials[0]!
    if (fence.kind !== "fence") throw new Error("expected a fenced node")
    expect(fence.raw).toBe(source.slice(fence.sourceFrom, fence.sourceTo))
    expect(fence.fenceChar).toBe("`")
    expect(fence.fenceLength).toBe(3)
    expect(fence.info).toBe("TS")
    expect(source.slice(fence.contentFrom, fence.contentTo)).toBe("**raw** [[not-a-link]]\r\n")
    expect(scan.protected).toEqual([{ sourceFrom: fence.sourceFrom, sourceTo: fence.sourceTo, kind: "fence" }])
    expect(scanRichLinks(source, scan.protected)).toEqual([])
  })

  it("keeps an unclosed or mismatched fence raw", () => {
    expect(scanRichSpecials("```js\n**raw**").specials).toEqual([])
    expect(scanRichSpecials("```js\nbody\n~~\n").specials).toEqual([])
    expect(scanRichSpecials("~~~js\nbody\n```\n").specials).toEqual([])
    const tableShaped = scanRichSpecials("```\n| a | b |\n| --- | --- |\n~~~\n")
    expect(tableShaped.specials).toEqual([])
    expect(tableShaped.protected).toEqual([{ sourceFrom: 0, sourceTo: tableShaped.protected[0]!.sourceTo, kind: "fence" }])
    const frontmatterShaped = scanRichSpecials("---\n| a | b |\n| --- | --- |\n")
    expect(frontmatterShaped.specials).toEqual([])
    expect(frontmatterShaped.protected[0]?.kind).toBe("frontmatter")
  })

  it("classifies Mermaid without changing the fence metadata", () => {
    const source = "```  MeRmAiD  \ngraph TD\n```"
    const scan = scanRichSpecials(source)
    expect(scan.specials).toHaveLength(1)
    const mermaid = scan.specials[0]!
    if (mermaid.kind !== "mermaid") throw new Error("expected a Mermaid node")
    expect(mermaid.info).toBe("MeRmAiD")
    expect(mermaid.raw).toBe(source)
  })

  it("records lossless table rows and escaped-pipe cell spans", () => {
    const source = "| Name \\| alias | Value |\r\n| :--- | ---: |\r\n|  café  | 42 |\r\n| last | row |"
    const scan = scanRichSpecials(source)
    expect(scan.specials).toHaveLength(1)
    const table = scan.specials[0]!
    if (table.kind !== "table") throw new Error("expected a table node")
    expect(table.raw).toBe(source)
    expect(table.aligns).toEqual(["left", "right"])
    expect(table.rows).toHaveLength(4)
    const header = table.rows![0]!.cells
    expect(header).toHaveLength(2)
    expect(header[0]!.text).toBe("Name \\| alias")
    expect(source.slice(header[0]!.contentFrom, header[0]!.contentTo)).toBe("Name \\| alias")
    expect(table.rows![2]!.cells[0]!.text).toBe("café")
    expect(table.rows![2]!.cells[1]!.text).toBe("42")
  })

  it("does not guess ambiguous pipe rows into tables", () => {
    expect(scanRichSpecials("plain | text\nnot a separator").specials).toEqual([])
    expect(scanRichSpecials("| header |\n| --- |\n\n| not | a table |").specials).toHaveLength(1)
    expect(scanRichSpecials("```\n| a | b |\n| --- | --- |\n```").specials).toHaveLength(1)
  })

  it("recognizes only a leading closed frontmatter block", () => {
    const source = "---   \r\ntitle: Keep:exact\r\n...  \r\nbody"
    const scan = scanRichSpecials(source)
    expect(scan.specials).toHaveLength(1)
    const frontmatter = scan.specials[0]!
    expect(frontmatter.kind).toBe("frontmatter")
    expect(frontmatter.raw).toBe(source.slice(frontmatter.sourceFrom, frontmatter.sourceTo))
    expect(source.slice(frontmatter.contentFrom, frontmatter.contentTo)).toBe("title: Keep:exact\r\n")
    expect(scanRichSpecials("body\n---\ntitle: x\n---").specials).toEqual([])
    expect(scanRichSpecials("---\ntitle: x").specials).toEqual([])
  })

  it("recognizes links, aliases, and bare web URLs outside protected spans", () => {
    const source = "[label](folder/note.md#part) [[target|Alias]] https://example.test/x"
    const scan = scanRichSpecials(source)
    const links = scanRichLinks(source, scan.protected)
    expect(links).toHaveLength(3)
    expect(links[0]).toMatchObject({
      kind: "markdown",
      target: "folder/note.md#part",
      label: "label",
    })
    expect(links[1]).toMatchObject({ kind: "wikilink", target: "target", label: "Alias", alias: "Alias" })
    expect(links[2]).toMatchObject({ kind: "autolink", target: "https://example.test/x", label: "https://example.test/x" })
    expect(scanRichLinks("https://example.test/a(b).", []).map((link) => link.target)).toEqual(["https://example.test/a(b)"])
    expect(scanRichLinks("**https://example.test/path**", []).map((link) => link.target)).toEqual(["https://example.test/path"])
    expect(links.every((link) => link.raw === source.slice(link.sourceFrom, link.sourceTo))).toBe(true)
  })

  it("leaves incomplete, empty, multiline, malformed, and escaped links untyped", () => {
    const source = "[empty]() [open](target\n[next](ok)\nlabel [[broken|alias]"
    expect(scanRichLinks(source, []).map((link) => link.raw)).toEqual(["[next](ok)"])
    expect(scanRichLinks("[x](a (b).md)", [])).toHaveLength(1)
    expect(scanRichLinks("[x](<a b.md>)", [])).toHaveLength(1)
    expect(scanRichLinks("\\[x](escaped.md) \\[[wiki]]", [])).toEqual([])
    expect(scanRichLinks("[[target\\|alias]]", [])).toEqual([])
    expect(scanRichLinks("[[outer [[inner]]", [])).toEqual([])
    expect(scanRichLinks("[outer [inner](x)](y)", [])).toEqual([])
  })

  it("never scans links inside any special block", () => {
    const source = "---\n[x](front.md)\n---\n| [x](table.md) |\n| --- |\n```\n[x](fence.md)\n```\n[x](outside.md)"
    const scan = scanRichSpecials(source)
    const links = scanRichLinks(source, scan.protected)
    expect(links.map((link) => link.target)).toEqual(["outside.md"])
  })

  it("keeps the special-node union discriminated", () => {
    const nodes = scanRichSpecials("```js\nx\n```\n| a |\n| --- |\n").specials
    for (const node of nodes as readonly RichSpecialNode[]) {
      if (node.kind === "table") expect(node.rows.length).toBeGreaterThan(0)
      else if (node.kind === "fence" || node.kind === "mermaid") expect(node.fenceChar === "`" || node.fenceChar === "~").toBe(true)
      else expect(node.kind).toBe("frontmatter")
    }
  })
})
