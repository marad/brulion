---
id: FEAT-0107
title: "Rich document contract and Markdown behavior matrix"
status: draft
depends_on: []
---

## Intent

Define the loss-aware rich Markdown document contract that lets CodeMirror show
readable rich text while Markdown remains the source of truth. The contract must
make visible/source positions, untouched-byte preservation, changed-span
serialization, pending input, and explicit source editing testable before the
editor model is implemented.

## Behavior

A document imports Markdown into visible text plus typed rich nodes and opaque
source islands. Every visible range maps deterministically to a UTF-16 source
range (and source ranges map back to visible positions where content is visible),
while delimiters and block prefixes are never caret stops in the visible view.
Unknown, unsupported, frontmatter, and special source are retained as opaque
islands until an explicit source-editing action changes them. Serialization uses
original source spans for untouched nodes and canonical Markdown only for newly
created or explicitly changed nodes; it never silently drops or reformats other
spans. A pending marker remains visible until its construct-specific boundary
is reached, and conversion is one undo transaction.

## Behavior matrix

| Construct | Recognition / pending state | Boundary and caret rule | Source editing and round-trip |
|---|---|---|---|
| Paragraph | Fallback line text; no pending marker | Enter inserts a visible newline | Original bytes preserved |
| Heading | `#{1,6}` followed by space; incomplete prefix stays literal | Space commits prefix; caret starts at visible content | Prefix is mapped source; changed heading uses `# ` |
| Bold / italic / inline code | Closed delimiter pair only; unmatched markers stay visible | Closing delimiter plus space commits; caret follows visible content | Imported delimiter spelling is retained; changed spans use `**`, `*`, `` ` `` |
| Quote / unordered list | Line prefix plus boundary whitespace | Enter continues; Enter on empty item exits to paragraph | Prefix is mapped and preserved until block edit |
| Ordered list | Numeric prefix is mapped as source-preserving/plain syntax | Enter is ordinary source editing; no auto-continuation or renumbering | Prefix and numbering remain byte-preserved unless explicitly source-edited |
| Markdown link / wikilink | Complete destination/target only | Link label is visible; target editing is explicit source mode | Target bytes remain untouched unless link is edited |
| Fence / Mermaid | Paired fence; open fence remains an opaque source island | Enter stays in explicit source editing; no cursor reveal exception | Entire fence is byte-preserved; Mermaid rendering is separate |
| Table | Header and separator rows form a contiguous block | Cell editing is explicit source editing | Pipes, spacing, and alignment bytes are retained |
| Frontmatter | Leading `---` pair only | Collapsed/expanded via explicit source affordance | Opaque and byte-identical |
| Unknown syntax | Opaque raw island | No inferred conversion or hidden caret stops | Never dropped or normalized |

## Acceptance criteria

- AC-1: Given Markdown containing supported nodes and unknown syntax, when it is
  imported, then the contract exposes visible text, typed marks/blocks, opaque
  islands, and deterministic visible/source UTF-16 mappings without hidden
  delimiter caret stops.
- AC-2: Given an imported document that has not been edited, when it is
  serialized, then the output is byte-identical, including delimiter spelling,
  whitespace, line endings, ordering, and unknown syntax.
- AC-3: Given an edit to one mapped node, when the document is serialized, then
  only that node's source span may use canonical output and all unrelated source
  spans remain byte-identical; unsupported or opaque source is never discarded.
- AC-4: Given each construct in the behavior matrix (paragraph, heading, inline
  marks/code, quote, unordered/ordered list, links, wikilinks, fence, table,
  frontmatter, Mermaid, and unknown syntax), when recognition, pending input,
  boundary, caret/Enter, source editing, and round-trip behavior are inspected,
  then each has an explicit rule and no rule depends on cursor-line reveal.
- AC-5: Given a Markdown marker sequence that has not reached its documented
  boundary, when the user types or moves the caret, then it remains editable
  source text; when the boundary is reached, then conversion produces the rich
  projection and trailing boundary text with one undo unit.
- AC-6: Given raw-source consumers such as storage, conflict handling, and the
  M46 extension API, when they request document content or UTF-16 positions, then
  they receive serialized Markdown/source coordinates rather than visible rich
  coordinates.

## Out of scope

- implementing the model, input rules, special renderers, persistence wiring, or
  browser validation; those belong to FEAT-0109 through FEAT-0115;
- replacing CodeMirror or introducing ProseMirror/Tiptap;
- metadata interpretation, whole-document Markdown reformatting, or HTML
  clipboard interoperability.
