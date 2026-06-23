# Copy fidelity — signature-fit review (FEAT-0045)

Adversarial trace of `serializeCopy(state, ranges)` against the CodeMirror
syntax tree + `sliceString`. Notation: `|` marks an offset; ranges are `[from,to)`.

## Scenario 1 — partial heading line (line-marker repair)
Doc: `## Hello world`. Selection `[5,10)` = `llo w` (started past `## `).
- `doc.lineAt(5)` → line from 0. First line is partially selected (`from > line.from`).
- Walk: `resolveInner(line.from, 1)` → `HeaderMark` child of `ATXHeading2`; its
  range is `[0,2)` and render hides `[0,3)` (mark + space, see render L168-173).
- Prefix must be `"## "` — but the **mark node is `[0,2)`, the trailing space is not
  in the node.** line-marker-repair must re-add the space itself, mirroring render's
  `mark.to + 1`. The arch doc's "leading line marker" wording doesn't pin whether the
  space is included. **Finding A:** ambiguous; HeaderMark excludes the space.

## Scenario 2 — selection inside a `StrongEmphasis` (single inline span)
Doc: `a **bold** b`. `StrongEmphasis` `[2,10)`, EmphasisMark `[2,4)`/`[8,10)`,
content `[4,8)`. Selection `[5,7)` = `ol`.
- For `from=5`: ancestor walk `resolveInner(5,1)` → text inside StrongEmphasis →
  parent StrongEmphasis. `from (5) > openMark.to (4)` ⇒ prepend `**`.
- For `to=7`: walk ⇒ `to (7) < closeMark.from (8)` ⇒ append `**`. Result `**ol**`. OK.

## Scenario 3 — nested span, italic-in-bold (nesting + ordering)
Doc: `**a *b* c**`. StrongEmphasis `[0,11)`; inside, Emphasis `[5,8)` wrapping `b`.
Selection `[6,7)` = `b` (inside both, content-only).
- `from=6` ancestor chain (innermost→outer): Emphasis `[5,8)`, StrongEmphasis `[0,11)`.
  Each span where `from > its-openMark.to` contributes its open delimiter. Walking
  innermost→outer yields `*` then `**`, but a valid reopen needs **outermost-first**:
  `** *`. **Finding B:** the natural ancestor walk (`n; n=n.parent`, as in
  `nodeAt`) produces open delimiters **innermost-first**; serializer must *reverse*
  them for the prefix. Arch doc edge table says inline-repair returns `string[]` but
  never states the order contract — under-specified, and the obvious walk is wrong order.
- `to=7`: same chain; close delimiters innermost-first `*` then `**` — which **is**
  the correct closing order. So open and close want opposite traversal orders from the
  *same* chain. The `(state, pos, side)` signature can encode this (side flips the
  reverse), but the doc never says so. **Finding B (cont.):** asymmetry unspecified.

## Scenario 4 — boundary-crossing: start inside bold, end in plain text
Doc: `**bold** tail`. StrongEmphasis `[0,8)`. Selection `[2,11)` = `bold** tai`.
- `from=2` is content-start, `> openMark.to (2)`? No — `2 == openMark.to (2)`. The
  selection begins exactly at content start, so **no open delimiter is missing** and
  prefix inline part = "". But the raw slice already *contains* the closing `**` at
  `[6,8)`. So output is `bold** tai` — already balanced-open, dangling-close is real
  text the user selected. Correct: no suffix synthesis (end is outside the span).
- **Finding C — the side-bias question (a):** at `from=2`, `resolveInner(2,1)` looks
  *forward* → lands on the StrongEmphasis content (or its first child), treating 2 as
  *inside*; `resolveInner(2,-1)` looks *backward* → lands on the EmphasisMark/open,
  treating 2 as *on the mark*. The serializer's "is the open delimiter inside the
  selection?" test must use the mark node's offsets (`from >= openMark.to` ⇒ already
  has it), **not** rely on which node `resolveInner` returns. The arch doc gives no
  rule for side, and `inline-repair`'s `(pos, side)` param is undocumented as to which
  side means what. **Material gap.**

## Scenario 5 — empty selection
Selection `[4,4)` (caret). Per `copyMarkdown` doc the handler returns false on empty
selection. `serializeCopy` must still be total: `from===to` ⇒ contributes `""`.
- **Finding D:** a *caret-only* range yields `""`, so a multi-range copy where one
  range is empty would join `["x", "", "y"]` → `"x\n\ny"`, injecting a blank line.
  The arch doc's "empty range contributes ''" + "join by lineBreak" combine into a
  spurious blank line. Needs a filter, unspecified.

## Cross-cutting findings

**(b) Blockquote markers — tree gap.** render (L368-389) hides `>` **structurally**,
scanning characters, *because the grammar drops `QuoteMark` nodes in cases* (e.g. `-`
continuation folding into Setext). A tree-based line-marker-repair keying on
`QuoteMark` will therefore **miss the marker on exactly those lines** the render
module already documents as node-less. line-marker-repair must mirror render's
character scan for `>`, not trust `QuoteMark`. The arch doc lists blockquote under
"line markers (… `>`)" via the tree — **wrong/insufficient** for these lines.

**(d) Fully-selected construct — double-add risk.** Doc `## Hi`, selection `[0,5)`
covers the whole line incl. `## ` start. Here `from === line.from`, so line-marker
repair must **not** prepend (the marker is already in the slice — well, the slice
starts at 0 but render hid `[0,3)` so the *visible* selection began at `H`; yet
`from` offset is 0). The guard "prepend only when `from > markerEnd`" is correct, but
the arch doc says "when the selection starts past it" — needs the offset test, not the
visual one. Same for inline: full span `[0,8)` of `**bold**` has `from=0 < openMark.to`
⇒ no synth; correct, but only if the test is offset-based. No double-add **iff** the
guard is `from > mark.to` / `to < closeMark.from` strictly.

**(e) Multi-line selection — which lines.** Only the **first** selected line needs
line-marker repair (per the stub doc: "first line's leading block marker"). But a
multi-line selection spanning several list items / quote lines drops the marker on
**every** subsequent line too (each is its own block line with a hidden marker). The
arch doc and `line-marker-repair (state, from)` signature only repair `from`'s line —
**Finding E:** interior lines of a multi-line selection lose their `>`/`*`/`#`
markers. Either out of scope (then say so) or the single-`from` signature is
insufficient.

## Resolutions (main agent)

Findings addressed before writing tests/bodies:

- **A (trailing space):** `lineMarkerPrefix` does NOT use `HeaderMark`/`ListMark`
  nodes. It scans the **first line's text** with a regex matching the runs render
  actually hides — `((?:> ?)*)(#{1,6} |[*-] )?` — and returns the full match
  (markers + their spaces) verbatim. This also resolves **(b)**: the `>` scan no
  longer depends on `QuoteMark` nodes the grammar sometimes drops.
- **B (ordering):** `inlineDelimiters(state, pos, side)` collects spans along the
  ancestor chain (innermost-first). For `side: "open"` it **reverses** to
  outermost-first (the reopen prefix); for `side: "close"` it keeps innermost-first
  (the close suffix). Verified on `**a *b* c**` → `***b***`.
- **C / d (offset guards, no double-add):** the test is purely offset-based, never
  the resolved node's side. Open delimiter is synthesized iff
  `openMark.to <= from < closeMark.from`; close iff `openMark.to < to <= closeMark.from`.
  So a full-span selection (`from <= openMark.from`) and a full-line heading
  selection (`from === line.from`) add nothing. Scenario 4 corrected: at `from=2`
  in `**bold** tail` the opening `**` (offsets `[0,2)`, before `from`) **is** dropped
  from the slice, so it is correctly re-synthesized → `**bold** tail`.
- **D (blank line):** `serializeCopy` joins every range's text with `state.lineBreak`,
  mirroring CodeMirror's own multi-range copy (an empty range contributes ""). The
  DOM binding only fires the custom path when at least one range is non-empty;
  exotic mixed multi-cursor parity with CM is accepted, not special-cased.
- **E (multi-line) — refuted.** Only the **first** selected line loses its marker.
  `sliceDoc(from, to)` is a contiguous substring: every *interior* line start is
  inside `[from, to)`, so its leading marker bytes are already in the slice. A
  3-line blockquote selected from line 1's visible text yields
  `line one\n> line two\n> line three` — only line 1's `> ` is missing. The
  single-`from` signature is therefore sufficient and complete.
