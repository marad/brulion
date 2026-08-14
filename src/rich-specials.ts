/**
 * Loss-aware recognition for M47 P4 links and special Markdown blocks.
 *
 * This module is deliberately source-only: it never renders, resolves, or
 * serializes a parsed construct. Every offset is a JavaScript UTF-16 offset in
 * the input string, and ambiguous syntax is omitted so the caller can keep it
 * as an opaque raw region.
 */

export type RichLinkKind = "markdown" | "wikilink" | "autolink"
export type RichSpecialKind = "fence" | "table" | "frontmatter" | "mermaid"
export type TableAlignment = "left" | "center" | "right" | "none"

export interface SourceSpan {
  sourceFrom: number
  sourceTo: number
}

export interface RichLinkNode extends SourceSpan {
  kind: RichLinkKind
  raw: string
  labelFrom: number
  labelTo: number
  targetFrom: number
  targetTo: number
  target: string
  label: string
  alias: string | null
}

export interface RichTableCell extends SourceSpan {
  tableFrom: number
  tableTo: number
  row: number
  column: number
  contentFrom: number
  contentTo: number
  text: string
}

export interface RichTableRow extends SourceSpan {
  row: number
  cells: readonly RichTableCell[]
}

interface FenceNode extends SourceSpan {
  kind: "fence" | "mermaid"
  contentFrom: number
  contentTo: number
  raw: string
  fenceChar: "`" | "~"
  fenceLength: number
  info: string
}

interface TableNode extends SourceSpan {
  kind: "table"
  contentFrom: number
  contentTo: number
  raw: string
  rows: readonly RichTableRow[]
  aligns: readonly TableAlignment[]
}

interface FrontmatterNode extends SourceSpan {
  kind: "frontmatter"
  contentFrom: number
  contentTo: number
  raw: string
}

export type RichSpecialNode = FenceNode | TableNode | FrontmatterNode

export interface ProtectedSourceSpan extends SourceSpan {
  kind: RichSpecialKind
}

export interface RichSpecialScan {
  specials: readonly RichSpecialNode[]
  protected: readonly ProtectedSourceSpan[]
}

/** Scan closed special blocks and return exact source spans. */
export function scanRichSpecials(source: string): RichSpecialScan {
  void source
  throw new Error("scanRichSpecials is not implemented")
}

/** Scan complete links outside the supplied special-block spans. */
export function scanRichLinks(
  source: string,
  protectedSpans: readonly ProtectedSourceSpan[],
): readonly RichLinkNode[] {
  void source
  void protectedSpans
  throw new Error("scanRichLinks is not implemented")
}
