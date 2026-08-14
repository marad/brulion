# M47 P4 — signatures

The new scanner is source-only and synchronous. It returns immutable metadata
rather than a second document model; `rich-markdown.ts` owns projection and
source-edit results.

```ts
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

export function scanRichSpecials(source: string): RichSpecialScan
export function scanRichLinks(
  source: string,
  protectedSpans: readonly ProtectedSourceSpan[],
): readonly RichLinkNode[]
```

Projection additions attach `link?: RichLinkNode` and `special?:
RichSpecialNode` to the existing `SourceMapRange`, and expose the same node
arrays on `RichDocument`. The explicit source-edit boundary is discriminated
by source range, not by a visible caret position:

```ts
export type SourceEditReason =
  | "link-label" | "link-target" | "table-cell"
  | "fence" | "table" | "frontmatter" | "mermaid" | "raw"

export interface SourceEditRange extends SourceSpan {
  kind: SourceEditReason
  node: RichLinkNode | RichTableCell | RichSpecialNode
}

/** Look up the exact source-edit island containing a raw UTF-16 position. */
export function sourceEditRangeAt(
  document: RichDocument,
  sourcePosition: number,
): SourceEditRange | null

/** Replace only a recognized link label or target, after raw-span freshness checks. */
export function editRichLink(
  document: RichDocument,
  link: RichLinkNode,
  edit: { label?: string; target?: string },
): RichDocument | null

/** Replace only a table cell's content, excluding pipe and spacing delimiters. */
export function editTableCell(
  document: RichDocument,
  cell: RichTableCell,
  text: string,
): RichDocument | null

/** Replace one complete fence/table/frontmatter/Mermaid source island. */
export function editSpecialSource(
  document: RichDocument,
  special: RichSpecialNode,
  text: string,
): RichDocument | null

/** Explicit escape hatch for an opaque source range, including malformed syntax. */
export function editRawSource(
  document: RichDocument,
  sourceFrom: number,
  sourceTo: number,
  text: string,
): RichDocument | null
```

Invalid offsets, stale nodes, cross-node ranges, and ambiguous table cells are
rejected with `null`; ordinary mapping APIs retain their existing `RangeError`
for out-of-bounds positions. A node is fresh only when its exact `raw` span (and
for a table cell its exact `text` span) still matches the supplied document.
Every accepted edit reimports the complete source in one operation.

## Signature self-review and regeneration

The first draft used a visible-position lookup for hidden link targets and a
`table,row,column` edit request. A cold signature-fit trace showed that neither
could identify a hidden target or a cell without a second hit-test, and stale
node freshness was ambiguous. The regenerated contract uses a raw source
position for `sourceEditRangeAt`, carries `raw` snapshots, and accepts a
`RichTableCell` directly with its table bounds. A discriminated special-node
union replaces optional metadata fields, so malformed node shapes have no public
construction path. `editRawSource` owns malformed/unknown source edits rather
than leaving that failure path implicit.

No async callback, resolver, cache, or serialization service is justified in P4.
The node object is immutable metadata, not a mutable rich tree or pass-through
manager.
