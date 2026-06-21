---
id: FEAT-0028
title: Web App Manifest and icons
status: draft
depends_on: []
---

## Intent

M9 makes Brulion an installable PWA. This first phase delivers the **describe-to-the-OS**
half: a Web App Manifest plus the icons it references, linked from `index.html`.
With it the OS/browser knows the app's name, colors, display mode, and icons, so a
later phase (the service worker) tips it over the installability bar. Nothing here
touches the user's notes — the manifest and icons are app build assets; the moat
(plain `.md` files on disk via the File System Access API) is untouched.

## Behavior

**Manifest file.** A `manifest.webmanifest` ships as a static asset (served under
the GitHub Pages base `/brulion/`). It declares:
- `name` ("Brulion — quick capture") and `short_name` ("Brulion"),
- `description`,
- `display: "standalone"` (own window, no browser chrome when installed),
- `theme_color` and `background_color` (a deliberate, consistent pair),
- `start_url` and `scope` resolved under the base path (`/brulion/`), so an
  installed launch lands on the app, not the domain root,
- an `icons` array referencing real files at **192×192** and **512×512**, with at
  least one entry marked `"purpose": "maskable"` so the installed icon fills the
  OS mask instead of being letter-boxed.

**Icons.** Generated from one simple source mark (a notepad glyph on the theme
color) at 192 and 512. A maskable variant keeps the glyph inside the safe zone.
The files ship in the build output under the base path.

**HTML wiring.** `index.html` links the manifest (`<link rel="manifest">`) using
the base path, sets a `<meta name="theme-color">` matching the manifest, and adds
an `<link rel="apple-touch-icon">` (so iOS "Add to Home Screen" gets an icon even
though it ignores the manifest's install flow).

**Build output.** All referenced files (`manifest.webmanifest`, every icon, the
apple-touch-icon) are present in `dist/` after `npm run build`, at paths that match
the URLs the manifest and HTML reference.

## Constraints

- **Moat untouched.** Manifest and icons are static app assets; they never
  reference, embed, or cache the user's `.md` files.
- **Base path.** Every URL (manifest `start_url`/`scope`/`icons[].src`, the HTML
  `<link>`s) resolves correctly under `/brulion/` on GitHub Pages, not the domain
  root. Use the same base mechanism the build already uses (`import.meta.env.BASE_URL`
  for code, relative or base-prefixed paths for static refs).
- **Lean.** No PWA build plugin. A static manifest committed to `public/` (Vite
  copies `public/` to the build root) plus committed icon files. Icon generation
  is a one-off, not a build-time dependency.
- **Installability not yet complete.** A manifest alone does not make the app
  installable — that needs the service worker (FEAT-0029). This phase is the
  metadata half and must not claim full installability.

## Out of scope

- The service worker / offline behavior (FEAT-0029).
- The `beforeinstallprompt` capture and in-app Install button (FEAT-0030).
- iOS-specific install-instruction UI.

## Acceptance criteria

**AC-1** — The manifest exists and declares the required install metadata.
Given the built site,
When `manifest.webmanifest` is parsed as JSON,
Then it has non-empty `name`, `short_name`, `display: "standalone"`, a
`theme_color` and `background_color`, a `start_url` and `scope` both under the
`/brulion/` base, and a non-empty `icons` array.

**AC-2** — The manifest references real icon files at the install sizes, including a maskable one.
Given the parsed manifest,
When its `icons` entries are inspected,
Then there is an icon of `sizes` `192x192` and one of `512x512`, at least one
entry has `purpose` including `maskable`, and every referenced icon `src` resolves
to a file that exists in the build output.

**AC-3** — `index.html` wires the manifest, theme color, and apple-touch-icon.
Given `index.html`,
When its `<head>` is inspected,
Then it contains a `<link rel="manifest">` pointing at the manifest under the base
path, a `<meta name="theme-color">` whose value equals the manifest's
`theme_color`, and a `<link rel="apple-touch-icon">` pointing at an icon file that
exists.

**AC-4** — All referenced assets are emitted to the build output.
Given a completed `npm run build`,
When `dist/` is listed,
Then `manifest.webmanifest`, every icon referenced by the manifest, and the
apple-touch-icon all exist at the paths the manifest and HTML reference.
