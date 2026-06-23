---
id: FEAT-0045
title: copy fidelity
status: draft
depends_on: [FEAT-0006, FEAT-0016]
---

## Intent

Copying a selection out of Brulion currently loses formatting at the selection's
edges. CodeMirror's default copy hands the clipboard `sliceDoc(from, to)` — the
raw markdown source that falls *inside* the selection. But markdown markup is
rendered as **atomic, hidden** ranges (FEAT-0006/FEAT-0016): the caret can never
land *inside* a `# `, `**`, `` ` `` or `> ` run, so a selection that begins from a
heading's visible text actually starts *after* the hidden `# ` and the slice omits
it — paste is no longer a heading. A selection that starts or ends inside a bold
span omits one or both `**` — pasted text loses its formatting, or worse, pastes
malformed markdown (`**half` with no close).

The loss is purely a **boundary** problem. The interior of `sliceDoc(from, to)` is
verbatim source and already carries every marker of every construct fully
contained in the selection. Only the first and last selected positions can sit
*past* an opening marker or *before* a closing one. So the fix is to repair the
two boundaries — pull in the line marker the first line is missing, synthesize the
inline delimiters the fragment is missing — never to re-serialize the whole
selection. The principle: **copy the selection, not the snagged construct** — add
exactly the markers needed to make the selected text valid, well-formed markdown,
and never a character more than what was selected (plus those repair markers).

This is an editor/clipboard concern only. The on-disk file is never read or
written here; the moat is untouched.

## Behavior

**A custom `copy`/`cut` handler re-serializes the selection.** On a copy or cut
the editor builds the clipboard text from the current selection itself, rather
than letting the browser/CodeMirror copy the raw slice. For each selection range
the text is `prefix + sliceDoc(from, to) + suffix`, where `prefix` and `suffix`
are the boundary repairs below; multiple ranges are joined by the document line
separator (matching CodeMirror's own multi-range copy). An **empty** selection is
left to the default behavior (CodeMirror copies the whole caret line) — there is
no fragment to repair.

**Line marker pulled in for a partially-selected first line.** When the
selection's start sits on a line whose leading characters are a hidden block
construct marker — an ATX heading (`#`…`######` + space), a blockquote (`>`
runs, possibly nested), or an unordered-list bullet (`*`/`-` + space) — and the
start is at or past the end of that marker run (so the slice dropped it), the
marker run is prepended. The marker is read verbatim from the document. This
applies only to the **first** selected line: every later line's leading marker
sits at a line start that is already inside the slice.

**Inline delimiters synthesized around the fragment.** When the selection's start
falls inside an inline span — strong emphasis (`**`/`__`), emphasis (`*`/`_`), or
inline code (`` ` ``…) — past that span's opening mark, the opening delimiter is
prepended. When the selection's end falls inside such a span before its closing
mark, the closing delimiter is appended. The delimiter text is read verbatim from
the document, so `__x__` round-trips as `__…__`, not `**…**`. Spans that the
selection fully contains need no repair (their marks are in the slice); spans the
selection starts/ends *outside* of are untouched.

**Nesting composes correctly.** When a boundary sits inside more than one inline
span (e.g. an italic run inside a bold run), the opening side prepends delimiters
**outermost-first** and the closing side appends **innermost-first**, so the
synthesized markers nest in the right order (a fragment inside `**_…_**` repairs
to `**_…_**`, never `_**…**_`). The line marker, when present, is the outermost
prefix (it precedes any inline opening delimiters).

**A full-construct selection is unchanged.** When the selection already includes a
construct's markers (e.g. the whole `**bold**`, or a line selected from its true
start including `# `), neither boundary needs repair and the clipboard text equals
the raw slice — no marker is doubled, nothing extra is added.

**Cut repairs identically, then deletes only the selected text.** A cut places the
same repaired markdown on the clipboard, then removes exactly the selected range(s)
from the document — never the synthesized repair markers, which live *outside* the
selection in the file. Cutting the fragment of a bold word leaves the remaining
word still validly wrapped (`**halfbold**`, cut "half" → clipboard `**half**`,
document `**bold**`).

**Links and wikilinks need no repair.** markdown-render already reveals a link's or
wikilink's raw `[text](url)` / `[[target]]` markup whenever the selection overlaps
it (FEAT-0026), so by the time a copy fires the raw markdown is visible and already
inside the slice. They are deliberately out of scope here.

## Constraints

- **Pure serializer.** The core `(state, ranges) → string` serialization is a pure,
  total function: it reads only the given state and ranges, never the clock, DOM,
  disk, or clipboard, and never throws. The DOM `copy`/`cut` wiring is a thin shell
  over it.
- **Never more than selected.** The output is the selected slice plus only the
  boundary-repair markers required to make it well-formed. No content outside the
  selection is ever copied (beyond the synthesized markers themselves).
- **Verbatim delimiters.** Repair markers are read from the document, never assumed,
  so `__`/`_`/multi-backtick spans and the exact heading/quote/list run survive.
- **Moat: untouched.** Nothing is read from or written to the folder; no on-disk
  bytes change. This is purely a clipboard transform.
- **Default for empty selection.** With an empty selection the handler does nothing
  and the editor's default copy/cut behavior stands.
- **Reuses the parse.** Boundary detection uses the existing CodeMirror markdown
  syntax tree (the same parse the renderer reads), not a second hand-rolled markdown
  scanner.

## Out of scope

- **Links / wikilinks.** Already handled by the selection-reveal in FEAT-0026; their
  raw markup is inside the slice when selected. Not repaired here.
- **Fenced code blocks.** Selecting code content copies plain text, which is already
  valid; the fences are whole lines, not a partial-line boundary. Only *inline* code
  (`` ` ``) is repaired.
- **Rich-text (`text/html`) clipboard flavor.** Copy keeping formatting into Docs/Word
  and HTML→markdown paste are the backlog's coupled "rich-text copy + paste" item, not
  this phase. M22 is plain-markdown fidelity only.
- **Paste.** This phase changes copy/cut only; paste is unchanged (markdown pastes as
  its source text as today).

## Acceptance criteria

**AC-1** — A partially-selected heading line keeps its marker.
Given a heading line whose `# ` marker is rendered hidden,
When the user copies a selection that starts from the heading's visible text (past
the hidden `# `),
Then the clipboard text begins with the heading marker run (`# …`), so it pastes
back as a heading.

**AC-2** — A blockquote / list line keeps its marker when partially selected.
Given a blockquote (`> `) or unordered-list (`*`/`-` ) line,
When the user copies a selection starting past the leading marker,
Then the clipboard text is prefixed with that line's marker run read verbatim from
the document.

**AC-3** — A fragment inside a bold span is wrapped on copy.
Given a bold span `**word**` rendered with hidden `**`,
When the user copies a selection wholly inside the visible word (touching neither
`**`),
Then the clipboard text is the fragment wrapped in `**…**`.

**AC-4** — A boundary-crossing selection stays well-formed.
Given a selection that starts inside a bold span and ends outside it (or vice
versa),
When the user copies it,
Then exactly the missing delimiter is synthesized at the open boundary and the
already-included closing delimiter is not duplicated — the result is valid markdown
with balanced `**`.

**AC-5** — Verbatim and nested delimiters are preserved.
Given an emphasis written with `_`/`__` or a nested span such as `**_text_**`,
When a fragment inside it is copied,
Then the synthesized delimiters match the document's actual characters and nest in
the correct order (open outermost-first, close innermost-first).

**AC-6** — A full-construct selection is byte-identical to the source.
Given a selection that already includes a construct's markers (the whole `**bold**`,
or a heading line selected including its `# `),
When the user copies it,
Then the clipboard text equals the raw selected source — no marker is doubled and
nothing outside the selection is added.

**AC-7** — Cut copies the repaired markdown and removes only the selected text.
Given any of the above selections,
When the user cuts instead of copies,
Then the clipboard receives the same repaired markdown as copy would, and the
document loses exactly the selected range — the synthesized repair markers (which
lie outside the selection) remain in the file, leaving it valid.

**AC-8** — An empty selection falls through to the default.
Given an empty selection (just a caret),
When the user copies or cuts,
Then the custom handler does nothing and the editor's default copy/cut behavior
applies.
