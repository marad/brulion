---
id: FEAT-0065
title: Light dark theme
status: draft
depends_on: [FEAT-0047, FEAT-0048]
---

## Intent

Brulion has a single hard-coded light look (colors scattered as literal hex across
`styles.css` and the editor theme). This phase adds a real **light / dark / system**
theme, chosen in the M16 settings modal and persisted with the vault. It is editor/UI
chrome only — the on-disk markdown is unchanged. (Split out of M16 deliberately so the
settings modal could ship on typography + Vim first.)

## Behavior

**The setting.** `Settings` gains `theme: "light" | "dark" | "system"`, persisted in
`.brulion.json`. Default is **`system`** — follow the OS's `prefers-color-scheme`. A
settings-modal control picks among the three.

**Applying it.** Colors become CSS custom properties (a small semantic palette: page
background, surfaces, text, muted text, borders, the brand accent, links, code
background, selection, soft-accent fills, shadows). The light values are the defaults;
a dark value set overrides them. The mode is applied by a `data-theme` attribute on
the document root:
- `system` (default): no `data-theme` — a `@media (prefers-color-scheme: dark)` rule
  supplies the dark palette on a dark OS, the light defaults otherwise.
- `light`: `data-theme="light"` — the light defaults always (overriding the OS).
- `dark`: `data-theme="dark"` — the dark palette always.

The editor (CodeMirror) reads the same custom properties, so the editing surface
themes with the rest. `color-scheme` is set to match so native form controls /
scrollbars follow.

**Scope of the recolor.** The migration keeps the **light** look effectively
unchanged (the default values are the current colors, near-duplicate shades collapsed
to one token); only dark is new.

## Constraints

- **Editor/UI only; bytes untouched (the moat).** Theming is CSS variables + a root
  attribute + the editor theme reading the vars; no note byte changes.
- **Reuse the settings engine.** `theme` rides the existing `Settings` model,
  `normalizeSettings`, and the modal's `onChange` patch flow (no new persistence).
- **System-follow via `prefers-color-scheme`,** not JS media polling — the CSS media
  query does it; JS only sets/clears the `data-theme` attribute.
- **Light unchanged.** The default (light) palette values equal today's colors so
  existing users on light see no change.

## Out of scope

- **Per-element theme overrides / custom palettes** — three modes only, one dark
  palette.
- **A theme transition animation.**
- **Syntax-highlight palette retuning for dark** beyond what the shared tokens give.

## Acceptance criteria

**AC-1** — `theme` persists and normalizes.
Given a vault,
When `theme` is set to one of `light`/`dark`/`system`,
Then it is saved in `.brulion.json` and restored on reload; `normalizeSettings`
coerces any other/missing value to `system`.

**AC-2** — Dark mode applies a dark palette.
Given `theme: "dark"`,
When applied,
Then the document root carries `data-theme="dark"` and the page/surface backgrounds
resolve to the dark palette (a dark background, light text).

**AC-3** — Light mode forces the light palette regardless of OS.
Given `theme: "light"` on an OS set to dark,
When applied,
Then `data-theme="light"` and the light palette is used (the OS preference is
overridden).

**AC-4** — System mode follows the OS.
Given `theme: "system"`,
When applied,
Then no `data-theme` attribute is set and the palette follows `prefers-color-scheme`
(dark on a dark OS, light otherwise).

**AC-5** — The settings modal picks the theme.
Given the settings modal is open,
When the user chooses light / dark / system,
Then the choice is reported (persisted) and the app re-themes live.

**AC-6** — The editor themes with the app.
Given dark mode,
When applied,
Then the editor surface (background/text) uses the dark palette too, not a fixed light
editor theme.

**AC-7** — No note bytes change.
Given any theme change,
When applied and persisted,
Then only `.brulion.json` is written; no `.md` file is touched.
