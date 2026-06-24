---
id: FEAT-0055
title: consistent header icon set with lucide and button normalization
status: draft
depends_on: [FEAT-0054]
---

## Intent

The M27 P1 review found the header's icons inconsistent: the new gear is a
hand-authored inline SVG (FEAT-0054) while the sidebar toggle is the Unicode glyph
`☰`. Because a text glyph is sized by line-height and an SVG by its own box, the two
header buttons even render at **different heights** — a visible rough edge. Hand-
authoring a one-off SVG per icon also doesn't scale: each new icon risks its own
size and stroke.

This phase routes the header icons through a single tree-shakeable icon set —
**Lucide**, the maintained successor to Feather, so the existing gear stays visually
the same. The `☰` toggle becomes a Lucide icon from the same family, every header
icon is sized uniformly, and the header button box is normalized so the controls
share one height. Header chrome only: no change to the editor or to file behavior.

Lucide is chosen over a Font Awesome webfont because it tree-shakes to only the
icons imported, needs no CDN (Brulion is an offline-capable PWA served from Pages —
everything is self-hosted in the bundle), and avoids the font-metric sizing and FOUT
of an icon font.

## Behavior

**Header icons come from Lucide.** The settings entry point (`#open-settings`) and
the sidebar toggle (`#toggle-sidebar`) render Lucide icons injected into their
buttons, replacing the hand-authored gear SVG and the `☰` glyph respectively. The
gear uses Lucide's `settings` icon (visually the Feather gear already shipped); the
sidebar toggle uses a panel/sidebar icon from the same family. No hand-authored icon
SVG markup remains in `index.html`.

**Uniform sizing.** All header icons render at one size, set in a single place
(CSS), so they cannot drift per-icon. The icons inherit the header text color
(`currentColor`).

**Equal button height.** The header buttons (the icon buttons and the text Install
button) render at the same height; the icon buttons are normalized (centered icon,
consistent box) so the toggle and the gear no longer disagree in height.

**Unchanged behavior.** Each button keeps its id, `aria-label`/`title`, and wiring:
the gear opens the settings modal (and `Ctrl/Cmd+,` still works), the toggle still
shows/hides the sidebar (and keeps `aria-pressed` and the `Ctrl+\` shortcut). Only
the rendered glyph and the buttons' sizing change.

## Constraints

- **Moat: untouched.** Header chrome only — a bundled build-time dependency and
  CSS/markup. No note `.md` bytes change, no new disk IO.
- **Self-hosted, tree-shaken.** Icons are imported individually and bundled by Vite;
  no CDN, no full-library webfont. *Why:* offline PWA + lean ethos.
- **No behavior regression.** ids, accessible labels, click handlers, keyboard
  shortcuts, and the `aria-pressed` semantics of the toggle are preserved.
- **Lean.** Inject the handful of header icons directly; no general icon-component
  abstraction beyond what uniform sizing needs.

## Out of scope

- **Re-skinning non-header icons** (the note-row delete `×`, the modal close `×`,
  the missing-note banner, the search `kbd`). They can adopt Lucide later if wanted;
  this phase is the header.
- **A theme/color change** — colors are unchanged (icons inherit `currentColor`).

## Acceptance criteria

**AC-1** — The settings gear is a Lucide icon, not a hand-authored SVG.
Given a folder is open,
When the header is shown,
Then `#open-settings` contains a Lucide-rendered `svg`, and `index.html` carries no
hand-authored gear `<path>` markup.

**AC-2** — The sidebar toggle is a Lucide icon, not the `☰` glyph.
Given a folder is open,
When the header is shown,
Then `#toggle-sidebar` contains a Lucide-rendered `svg` and no longer renders the
`☰` text glyph.

**AC-3** — The two header icon buttons render at the same height.
Given a folder is open,
When the header is shown,
Then the `#toggle-sidebar` and `#open-settings` buttons have equal rendered height.

**AC-4** — The header icons are the same size.
Given a folder is open,
When the header is shown,
Then the gear and the toggle icons render at the same width and height.

**AC-5** — Button behavior and shortcuts are unchanged.
Given a folder is open,
When the user clicks the gear (or presses `Ctrl/Cmd+,`) and clicks the toggle (or
presses `Ctrl+\`),
Then the settings modal opens and the sidebar toggles respectively, and both buttons
keep their accessible labels and the toggle keeps its `aria-pressed` state.
