---
id: FEAT-0066
title: Dark-mode syntax highlight palette
status: draft
depends_on: [FEAT-0049, FEAT-0065]
---

## Intent

M18's theme (FEAT-0065) deliberately deferred the code-block **syntax-highlight**
palette: the `tok-*` token colors in `code-highlight.ts` stayed a fixed GitHub-light
set. On a dark theme those light colors (a near-black navy for strings, mid blues for
numbers/properties) sit on the dark code box with poor contrast — code blocks are the
one surface that still reads as "light theme" in dark mode, so the theme feels
incomplete. This phase (M18 P2) makes the syntax palette theme-aware: the same `tok-*`
tokens flip to a dark-readable set in dark mode, with the light look unchanged.

## Behavior

The seven distinct syntax colors become CSS custom properties (`--tok-keyword`,
`--tok-string`, `--tok-number`, `--tok-comment`, `--tok-function`, `--tok-type`,
`--tok-tag`), defined alongside the rest of the M18 palette: light values equal
today's GitHub-light colors, a dark override set supplies a GitHub-dark-readable
palette. `code-highlight.ts`'s `codeTokenTheme` references the tokens via `var(--…)`
instead of literal hex. The tokens flip with the same `data-theme` / `prefers-color-scheme`
mechanism as the rest of the palette — no new switching logic. Token classes that
shared a hex in light (e.g. property names and numbers both blue) keep sharing one
token, so the light rendering is byte-identical.

## Constraints

- **Reuse the M18 mechanism.** The syntax tokens ride the existing `:root` /
  `:root[data-theme="dark"]` / `@media (prefers-color-scheme: dark)` blocks; no new
  theme plumbing.
- **Light unchanged.** Each light token value equals the exact color it replaces in
  `code-highlight.ts` today.
- **Code-blocks only.** The marks only land inside fenced blocks (FEAT-0049); prose is
  untouched. No change to that scoping.
- **No note bytes change (the moat).** Coloring is CSS only.

## Out of scope

- **A user-selectable syntax theme** — one light + one dark palette, tied to the app
  theme.
- **Per-language palettes** or richer token classes than `classHighlighter` already
  emits.

## Acceptance criteria

**AC-1** — The syntax palette is theme-aware.
Given a fenced code block,
When the theme is dark,
Then its tokens are colored from the dark syntax palette (readable on the dark code
box), and when light, from the light palette.

**AC-2** — The light syntax rendering is unchanged.
Given `theme: "light"` (or a light OS in system mode),
When a code block renders,
Then every `tok-*` class resolves to the exact color it had before this phase.

**AC-3** — System mode follows the OS for syntax too.
Given `theme: "system"`,
When the OS prefers dark,
Then the syntax tokens use the dark palette (no `data-theme` attribute required).

**AC-4** — No note bytes change.
Given any theme,
When code blocks are highlighted,
Then no `.md` file is written — the coloring is CSS only.
