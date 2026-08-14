# M47 P4 — signature-fit and implementation self-review

## Cold signature-fit review

A fresh reader traced these scenarios against the initial signatures:

1. A complete Markdown link projects through `scanRichSpecials` →
   `scanRichLinks` → the rich projection → `editRichLink`.
2. A malformed link returns no scanner node and is handled by the existing raw
   fallback or the explicit `editRawSource` escape hatch.
3. A table-cell edit uses one `RichTableCell` snapshot, then the edit boundary
   validates its table bounds and content span before reimporting.
4. A hidden link target is located by a raw source position through
   `sourceEditRangeAt`; visible positions remain the rich-label coordinate
   system.
5. A full special-block edit validates its exact `raw` span before replacing it.

The cold review found that the first signatures were ambiguous about stale-node
freshness, duplicated table identity as `(table,row,column)`, and attempted to
look up hidden link targets from visible positions. The signatures were
regenerated before tests: nodes now carry raw snapshots, table edits accept a
fresh cell node, `sourceEditRangeAt` takes a raw source position, and
`editRawSource` owns malformed/unknown syntax.

## Fresh implementation self-review

A fresh diff read found two file-fidelity gaps:

- escaped `\[x](...)` and `\[[x]]` could be recognized as links;
- unmatched closing parentheses could remain part of a bare URL node.

The scanner now rejects escaped opening/closing delimiters, ignores special
syntax inside HTML comments, trims only unmatched URL punctuation/parentheses,
and has discriminating regression tests. The same review noticed a source-range
test was selecting a table separator row rather than a body cell; it was
corrected to exercise a body-cell mapping. Earlier table test expectations also
had the wrong row count/index for a four-row fixture and were corrected before
acceptance.

## Reconsideration

The implementation keeps one source scanner rather than copying recognition into
the old CodeMirror renderers. Special blocks remain raw/source-visible in this
pure model, and `replaceVisible` rejects them so only the explicit source APIs
can mutate them. This is simpler and safer than adding a second placeholder
projection before P5/P7. Link labels reuse the existing inline parser instead
of introducing a new nested-mark parser.

## Simplification and performance

The scanner has no cache or asynchronous work. Table rows are scanned once per
source import; link candidates are indexed per line and the vault-sized input
is small. An early unused table-boundary scratch calculation was removed. The
only repeated scans are the existing immutable re-projection passes after an
explicit edit, which is the intended consistency boundary.
