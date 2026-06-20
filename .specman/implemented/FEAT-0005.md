---
id: FEAT-0005
title: Editor typography
status: draft
depends_on: [FEAT-0001]
---

## Intent

The pipeline works, but the editor still looks like a code box: monospace text
spanning the full width of the window. For a tool whose whole job is to be a
pleasant place to jot things down, that is a dealbreaker — quick-capture has to
feel inviting, not like editing a config file. This phase gives the editor clean,
readable typography: a proportional reading font, a comfortable measure and line
spacing, and lightly-styled page chrome so the app doesn't read as an unstyled
HTML document. It deliberately does **not** hide or render markdown syntax —
markup is still visible as plain text; making it read as rich content is M2. The
bar here is simply: the editor is pleasant to write in.

## Behavior

The editor renders in a proportional, system reading font (a `system-ui` /
native font stack — no web-font downloads, keeping the app zero-config and
offline-friendly), not CodeMirror's default monospace. Body text sits at a
comfortable size (~16px) with generous line spacing (~1.6). The text column is
capped at a readable measure (~60–70 characters) and centered in the window
rather than stretching edge to edge, with comfortable padding. The surrounding
chrome — the "Open folder"/"Resume" controls, the file list, the conflict status
line — is given minimal, tidy styling (spacing, muted colors) so the page looks
intentional. Colors stay light and neutral; no theming system, no dark mode in
M1.

## Constraints

- No web-font downloads — use a system font stack (zero-config / offline ethos).
- No syntax hiding, WYSIWYG, or markdown rendering — that is M2.
- No theming system / dark mode in M1; a single clean light appearance.
- Styling only — no change to editor behavior, save logic, or file handling.

## Out of scope

- Hiding markdown syntax / rich rendering / slash commands — M2.
- Dark mode, theme switching, user-configurable fonts — later.

## Acceptance criteria

**AC-1** — The editor uses a proportional reading font, not monospace.
Given the app is loaded with the editor visible,
When the editor's text style is inspected,
Then the editor content's computed `font-family` is the app's proportional
system stack (it is not a monospace font).

**AC-2** — The text column is capped to a readable measure and centered.
Given the editor is shown in a wide window,
When the editor content area is measured,
Then the text column is narrower than the full viewport (capped to a readable
measure) and is horizontally centered rather than left-flush to the window edge.

**AC-3** — Body text is comfortably sized and spaced.
Given the editor is loaded,
When the editor content's computed style is inspected,
Then the font size is at least 16px and the line height is at least 1.5× the
font size.
