---
id: FEAT-0007
title: Editor formatting shortcuts
status: draft
depends_on: [FEAT-0006]
---

## Intent

With markup now hidden (FEAT-0006), the user needs a way to *create* formatting
without typing raw markers — otherwise the only way to make text bold is to type
`**` around it, which then vanishes and is awkward to edit. This phase adds the
keyboard shortcuts that reshape the underlying markdown: bold/italic/inline-code
toggles and heading-level changes. The shortcuts edit the plain markdown text in
the document (the moat is untouched — they insert/remove ordinary `*`, `**`,
`` ` ``, `#` characters), and the FEAT-0006 rendering then displays the result as
rich text.

The formatting logic lives in **one set of pure transforms** on the editor
state + selection (no DOM), so that the later slash-command and right-click
surfaces (FEAT-0008/0009) reuse exactly the same correct, unit-tested code rather
than re-deriving how to edit the markdown.

Underline is deliberately **not** offered (`Ctrl+U` is unbound) — markdown has no
underline and faking it needs raw HTML, which dirties the file (see
`DECISIONS.md`).

## Behavior

The editor binds these shortcuts (taking precedence over any default binding;
none may be left shadowed by a CodeMirror/browser default):

- **`Ctrl/Cmd+B`** — toggle **bold** around the selection. With a selection: wrap
  it in `**…**`; if it is already bold, remove the bold. With no selection:
  insert `****` and place the caret between the markers, ready to type.
- **`Ctrl/Cmd+I`** — toggle *italic* (`*…*`), same rules.
- **`Ctrl/Cmd+E`** — toggle inline `code` (`` `…` ``), same rules.
- **`Ctrl/Cmd+↑`** — promote the current line's heading level one step:
  paragraph → H3 → H2 → H1 (stops at H1).
- **`Ctrl/Cmd+↓`** — demote one step: H1 → H2 → H3 → paragraph (stops at
  paragraph). Paragraph is a state in the cycle, so a heading can be removed, not
  only changed.
- **`Ctrl/Cmd+Shift+1` / `+2` / `+3`** — set the current line directly to H1 / H2
  / H3.

Toggling is reversible: applying the same inline shortcut twice returns the text
to plain. Heading changes rewrite only the line's `#` prefix, never the line
text. Bold/italic are distinguished correctly — toggling italic on already-bold
text does not corrupt the `**` markers, and vice-versa.

The transforms are pure functions of `(document, selection)`: given the state and
the selection they compute the text change and the resulting selection, with no
dependency on the view or the DOM. The keymap entries are thin adapters that
dispatch the computed change.

## Constraints

- **Clean markdown only.** Every edit inserts/removes standard CommonMark
  characters (`*`, `**`, `` ` ``, `#`). Nothing else is written — no HTML, no
  underline.
- Transforms must be pure (state + selection in, change + selection out) and unit
  tested without a browser.
- Shortcuts must actually fire in the editor — verify none is swallowed by a
  default CodeMirror/browser binding (`Ctrl+↑/↓` in particular).
- Inline toggles must not mis-detect `*` inside `**` (italic vs bold) — use the
  parsed markdown structure, not a naive character scan.

## Out of scope

- Slash commands (`/h1`, `/clear`) — FEAT-0008.
- Right-click multi-line formatting popup — FEAT-0009.
- Lists, links, blockquotes, strikethrough, underline.

## Acceptance criteria

**AC-1** — Ctrl+B wraps a selection in bold and renders it bold.
Given the document `hello world` with `world` selected,
When the user presses Ctrl+B,
Then the document becomes `hello **world**` and `world` renders bold.

**AC-2** — Ctrl+B on already-bold text removes the bold.
Given the document `hello **world**` with `world` (the visible word) selected,
When the user presses Ctrl+B,
Then the document becomes `hello world` (the `**` markers are gone).

**AC-3** — Ctrl+I toggles italic and Ctrl+E toggles inline code, with the same
wrap/unwrap behavior.
Given a selected word,
When the user presses Ctrl+I (resp. Ctrl+E),
Then the word is wrapped in `*…*` (resp. `` `…` ``); pressing the same shortcut
again with the word selected removes the markers.

**AC-4** — An inline shortcut with no selection inserts empty markers ready to
type.
Given an empty caret (no selection),
When the user presses Ctrl+B,
Then `****` is inserted and the caret sits between the two `**`, so typing
produces bold text.

**AC-5** — Ctrl+↑ promotes the heading level one step toward H1.
Given a plain paragraph line `note`,
When the user presses Ctrl+↑ three times,
Then the line becomes `### note`, then `## note`, then `# note` (and stays `# note`
on a fourth press).

**AC-6** — Ctrl+↓ demotes the heading level and can remove the heading.
Given a line `# note`,
When the user presses Ctrl+↓ three times,
Then the line becomes `## note`, then `### note`, then `note` (heading removed).

**AC-7** — Ctrl+Shift+1/2/3 set the current line's heading directly.
Given a plain line `note`,
When the user presses Ctrl+Shift+2,
Then the line becomes `## note`; pressing Ctrl+Shift+1 then makes it `# note`.

**AC-8** — Italic and bold do not corrupt each other.
Given the document `**word**` with the visible `word` selected,
When the user presses Ctrl+I,
Then the result is italic *inside* bold (`***word***` or `*​*​*word*​*​*`
equivalent) — the original `**` bold markers are preserved, not broken into
`*…*`.

**AC-9** — Ctrl+U does nothing destructive (underline is unsupported).
Given any document,
When the user presses Ctrl+U,
Then no underline markup or HTML is inserted into the document.
