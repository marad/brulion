# M47 P4 excavation decisions

## Scope

P4 extends the existing loss-aware Markdown projection with complete links and
wikilinks plus typed source-preserving nodes for fences, tables, frontmatter,
and Mermaid. Persistence, navigation, CodeMirror view widgets, and controller
wiring remain later phases.

## Load-bearing decisions

- **Model boundary:** the rich model owns recognition, UTF-16 source spans, and
  explicit source edits. Existing renderers are consumers, not parsers of record.
- **Special-block representation:** fences, tables, frontmatter, and Mermaid are
  typed opaque source islands. Their raw source stays visible in the pure model;
  no placeholder text or rendered HTML is serialized. This avoids hidden caret
  semantics before the P5/P7 CodeMirror adapters exist.
- **Link representation:** link labels are visible rich fragments and link
  targets/delimiters are mapped but non-visible. Link resolution against a vault
  is out of scope; the node records raw targets only.
- **Editing:** normal visible replacement may edit a mapped label fragment, but
  target, delimiter, table-cell, and special-block changes require an explicit
  source edit API. The API rejects stale or cross-node ranges rather than
  normalizing a construct it cannot prove lossless.
- **Parsing:** complete constructs are recognized only in one-line links or
  closed protected blocks. Incomplete, malformed, ambiguous, or unsupported
  source remains one opaque raw region.
- **Errors:** pure recognizers return `null`/empty matches for malformed input;
  explicit edit functions return `null` for invalid or stale requests. They do
  not throw for ordinary user input, while existing out-of-bounds mapping APIs
  retain their `RangeError` contract.

## Deferred

- How CodeMirror replaces a special source island with a widget while preserving
  visible selection and viewport anchors (P5/P7).
- Link path resolution, navigation, autocomplete, and anchor scrolling.
- Full CommonMark destination/title parsing beyond the lossless one-line subset.
