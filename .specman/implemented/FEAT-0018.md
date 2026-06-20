---
id: FEAT-0018
title: "Markdown-aware Enter: continue and exit lists/quotes"
status: draft
depends_on: [FEAT-0016]
---

## Intent

Since M1 the editor carries a list/blockquote prefix onto the next line when you
press Enter (an incidental effect of the markdown language's indentation). It is
good quick-capture UX — typing a multi-item list shouldn't make you retype `* `
each line — but it has a rough edge surfaced during the M5 review: there is no way
to *leave* the construct. Pressing Enter on an empty continued item just produces
another empty `* `/`> ` line, so the user is stuck adding marker lines (and it was
part of the confusion behind the FEAT-0016 `> -` report).

This phase makes Enter properly markdown-aware: it still continues a list or
blockquote, but pressing Enter on an **empty** item removes the marker and exits
the construct — the standard behavior of every markdown editor. The on-disk file
keeps only the plain markdown that results (no stray empty `* ` lines); the moat is
unaffected because this only changes what Enter inserts, never rewrites existing
text.

## Behavior

Enter is bound to the markdown package's continuation command
(`insertNewlineContinueMarkup`), at a precedence that:

- continues an unordered list (`*`/`-`), an ordered list (`1.`), and a blockquote
  (`>`): the new line starts with the same marker, ready to type;
- on an **empty** item or quote line (the marker with no content after it),
  removes the marker(s) instead of continuing — exiting the construct and leaving
  a plain line. The whole empty marker line is cleared, so a nested empty item
  exits all its levels at once (uniform across lists and blockquotes; the library
  command alone would need two Enters to leave a quote, which we avoid).
- on a plain (non-list, non-quote) line, falls through to the normal newline
  behavior — Enter there is unchanged.

It must not interfere with the slash-command menu (FEAT-0008): while the
autocomplete popup is open, Enter still accepts the highlighted completion rather
than inserting a newline.

## Constraints

- **Reuse, don't reinvent.** Use the `@codemirror/lang-markdown` continuation
  command rather than hand-rolling marker detection.
- **File fidelity.** Enter only changes what is inserted/removed at the caret; it
  never rewrites or normalizes the rest of the document.
- **Slash menu wins.** When the completion popup is open, Enter accepts the
  completion (the slash command keeps working).

## Out of scope

- Backspace-to-unindent / delete-marker behavior — could be added later
  (`deleteMarkupBackward`), but this phase is only about Enter.
- Auto-renumbering ordered lists, checkbox/task-list toggling — not in the
  rendered set and not requested.

## Acceptance criteria

**AC-1** — Enter continues an unordered list.
Given the caret is at the end of a line `* item` (an unordered-list item),
When the user presses Enter,
Then the new line begins with a `*` marker (the list continues).

**AC-2** — Enter continues a blockquote.
Given the caret is at the end of a line `> quoted`,
When the user presses Enter,
Then the new line begins with a `>` marker (the quote continues).

**AC-3** — Enter on an empty list item exits the list.
Given the caret is on an empty continued list item (a line that is just the
marker, e.g. `* `),
When the user presses Enter,
Then the marker is removed and the caret is left on a plain, empty line (the list
is exited); no empty `* ` line is left in the document.

**AC-4** — Enter on an empty blockquote line exits the quote.
Given the caret is on an empty continued quote line (just `> `),
When the user presses Enter,
Then the `>` marker is removed and the caret is left on a plain line.

**AC-5** — Enter on a plain line is unchanged.
Given the caret is on a plain paragraph line (no list/quote marker),
When the user presses Enter,
Then a normal new line is inserted (no marker added).

**AC-6** — The slash menu still accepts on Enter.
Given the user has typed `/h1` and the slash-command popup is open,
When the user presses Enter,
Then the completion is accepted (the line becomes a heading), not a newline
inserted.
