# Brulion — Roadmap

Browser-based quick-capture notepad. Reads and writes `.md` files **directly in
a folder on the user's disk** via the File System Access API — no install, no
backend, no cloud. Open a URL on any machine (even an unconfigured, foreign
one), take notes, and the files stay as plain markdown the user owns.

Origin: real pain — jotting down Diablo builds on a Windows gaming box with
nothing set up (no Neovim+vinote, no Obsidian). Not an Obsidian replacement.
Narrow niche: **zero-config quick-capture on a foreign machine**.

The moat is **the files**: plain markdown on the user's disk, no lock-in.
Every technical decision defers to that.

## Milestones

### M1 — Full pipeline on a single note
**Goal:** prove the whole plumbing works end-to-end on one note, before adding
anything pretty or multi-note. Phases: [`milestones/M1.md`](milestones/M1.md).

In:
- Vite + TypeScript + CodeMirror 6 skeleton.
- Deploy to GitHub Pages via Actions (`git push` → new version on refresh).
- Folder picking (`showDirectoryPicker`), handle persisted in IndexedDB,
  permission re-grant flow across sessions.
- Open folder → if empty, create `start`; read, edit, **save** `start` to disk,
  survives restart.
- Editor: CodeMirror 6 with **clean typography** (must not be ugly), but
  **no syntax hiding** — that is M3.

Out (deliberately): multi-note UI, syntax hiding / WYSIWYG, links, PWA.

Success: notes for real survive a restart from a deployed URL.

### M2 — The editor experience (the heart of the product)
**Goal:** Notion-like feel — markdown markup **never visible**, text reads as
rich content. Markdown stays purely as the on-disk serialization format. This
is the differentiator over `papier`, so it comes before multi-note.
- Hide syntax on all lines, including the cursor line (no Obsidian-style flicker).
- Slash commands to reshape a line: `/h1`, `/h2`, `/clear`, etc.
- Right-click popup to format across multiple lines.
- Keyboard shortcuts: Ctrl+B (bold), Ctrl+I (italic), Ctrl+E (inline code).
- Heading level by **Ctrl+↑/↓** — cycles the current line's level: ↑ promotes
  (paragraph → H3 → H2 → H1), ↓ demotes back down to a plain paragraph.
  Paragraph is a state in the cycle, so a heading can be removed, not just
  changed. Direct jumps Ctrl+Shift+1/2/3 kept alongside as a one-chord shortcut.
  (Verify Ctrl+↑/↓ doesn't clash with a CodeMirror/browser default binding.)
- No button toolbar — this is not Windows 95.

> Open: **underline (Ctrl+U)**. Markdown has no native underline — `__x__` is
> *bold* in CommonMark. Supporting it means writing raw `<u>…</u>` HTML into the
> file, which dirties the "clean markdown" moat. Decide whether to support it at
> all, and at what cost to the file.

### M3 — Multiple notes
**Goal:** list, create, switch, delete notes. Plain UI on top of the M1+M2
foundation. User names notes themselves.

### M4 — External edits & conflict handling
**Goal:** make Brulion a well-behaved *view* on a folder that other tools also
write to (AI, CLI, vinote, a native capture helper). The folder is the API; the
app must not own or clobber the data. See `DECISIONS.md` → "Files are the
interface" and "External edits & conflict handling".
- Detect files changed/added/removed from outside — watch or poll
  `getFile().lastModified`; refresh the view.
- Conflict resolution UX when the on-disk file moved under an open edit (M1 only
  ships the cheap stale-write guard that *detects* this and refuses silent
  overwrite; M4 is the real handling).
- Moat-relevant (silent clobber = data loss), so a candidate to pull earlier
  than this slot if it starts biting.

### M5 — Finish the editor (rendering gaps)
**Goal:** pay down the debt on the heart of the product. M2 promised to hide
markdown markup, but several constructs still show raw markers — reported from
real use. This is not a new feature; it's M2's promise kept. Likely
`markdown-render.ts` decorations plus `markdown-transforms.ts` for clear-format.

In:
- **Fenced / multi-line code blocks** (```` ``` ````) render as a code block,
  not raw fences.
- **Blockquotes** (`> …`) render as quoted content, not a literal `>`.
- **Unordered lists** (`*`, `-`) render as list items, not a literal marker.
- **Clear Formatting strips inline code** (`` `…` ``) too — and audit whether it
  misses other inline/block marks while fixing.

### M6 — Editor comfort
**Goal:** make daily writing nicer. Lean additions living in the CodeMirror layer,
none of which touches the file format.
- **Bullet caret/glyph glitch while typing a marker (fix first — M5 follow-up).**
  When you type a bare `*` or `-`, the caret looks like it already sits one space
  in (the rendered `•  ` glyph from `::before` carries trailing spaces and the
  hidden marker is atomic), but the document is still just `*` with no space — so
  the next character you type appears *before* the literal `*`, which pops back
  into view at the line start. Conversely, typing the space that completes `* `
  barely moves the caret (the `* ` hides and the `•  ` glyph takes nearly the same
  width). Net: caret position and the rendered bullet disagree while the marker is
  mid-typing. Likely needs the bullet rendered as a fixed-width replacement of the
  actual `*`/`- ` run (a widget/decoration sized to the marker) instead of a
  `::before` glyph layered on top of an atomically-hidden marker, so the caret and
  the glyph stay in sync as you type. Reported in the M5 review; fix before the
  comfort features below.
- **Collapsible note list** — hide/show the left sidebar for a distraction-free,
  editor-only view; remember the state.
- **Vim mode** — opt-in Vim keybinding layer (`@replit/codemirror-vim`); must not
  fight the slash/format commands.

### M7 — Conflict diff/preview
**Goal:** make the M4 conflict choice an informed one. When the conflict modal
(FEAT-0015) appears, show *what* changed — your version vs the on-disk version —
so "use the version on disk" isn't blind. A diff view and the UI to show both sides.

### M8 — Links & subfolders
**Goal:** stop treating the folder as a flat list. Grouped because both are the
same domain — paths, not just names.
- **Links between notes** — parsing, path resolution, navigation, missing-target
  handling (a `papier` gap and a differentiator).
- **Subfolders** — nested folder support: recursive listing, a tree UI in the
  sidebar, name/path handling, and how create/delete and the M4 poller behave
  across nesting.

### M9 — PWA
**Goal:** make Brulion installable and offline-capable. Installable window/icon,
`beforeinstallprompt`, offline via service worker.

### M10 — Welcome / first-run screen
**Goal:** replace the bare pre-folder state (an empty editor + a lone "Open
folder" button) with a deliberate first-run screen: what Brulion is, the
file-fidelity promise stated as a feature, and a clear call to open a folder —
plus tidy header-control visibility before vs after a folder is open. Pure UI on
the existing foundation; no change to file behavior. Phases:
[`milestones/M10.md`](milestones/M10.md).

### M11 — Vim caret respects hidden markup
**Goal:** fix a Vim-mode defect — the Vim cursor can land on characters that are
visually hidden (line-start `#`, `>`, list markers, inline marks), so navigation
stops on glyphs the user can't see. Editor-layer fix in the CodeMirror Vim
integration / decoration layer; no change to file behavior.

In:
- Vim motions skip over atomically-hidden syntax so the caret only rests on
  visible content.
- Audit which hidden constructs are affected (headings, blockquotes, list
  markers, bold/italic/code marks) and cover them consistently.

### M12 — Quick switcher & note creation (Ctrl+K / Cmd+K)
**Goal:** one keyboard-first way to find and create notes. `Ctrl+K` (`Cmd+K` on
mac) opens a quick switcher: fuzzy-search across note names, arrow/Enter to jump.
When the query matches nothing, Enter **creates** a note with that name — which
also retires the current weak UX of typing a name into the left-sidebar textbox.
This is the M3 note-management surface done right; pure UI on the existing
note list/create/switch logic, no change to file behavior.

In:
- `Ctrl+K` / `Cmd+K` overlay with fuzzy filtering over existing note names.
- Keyboard nav (↑/↓, Enter to open, Esc to close); mouse optional.
- Create-on-miss: Enter on a non-matching query creates that note and opens it,
  reusing the existing create path.
- Remove the left-sidebar inline-create textbox — the switcher is now the single
  way to create a note.

### M13 — Sidebar comfort: collapsed-by-default tree + resizable width
**Goal:** make the note tree pleasant in a large vault. Two independent tweaks in
the sidebar layer; no change to file behavior.
- **Folders collapsed by default** — the tree opens collapsed (only top level
  shown), the user expands what they need; keep honoring the persisted
  expand/collapse set and the "reveal the active note's ancestors" rule.
- **Drag-to-resize width** — grab the sidebar/editor border and drag to set the
  sidebar width; persist it (alongside the other `brulion:` UI state). Replaces the
  fixed `14rem`.

### M14 — Open-note identity in the header + rename
**Goal:** always show *which* note is open, and let it be renamed in place. The two
pair up — the header name is the rename affordance.
- **Show the open note's name and path** in the top panel.
- **Rename the current note** — edit the name (e.g. click the header name), moving
  the file on disk via the existing path-addressed storage; update links/active
  state. Reuses the `normalizeNoteName` validator. Moat-relevant: a rename is a
  real file move, so it must be atomic-ish and never lose content.

### M15 — Code-block syntax highlighting
**Goal:** fenced code blocks (FEAT-0016 renders them as a box) get syntax colors
for the most popular languages, driven by the fence's info string (```` ```ts ````).
Editor-only (CodeMirror language data / highlight); the on-disk markdown is
unchanged — purely how the block is painted.

### M16 — Settings modal
**Goal:** a single place for preferences instead of scattered header toggles.
**Scope is open — to be agreed with the user before building** (candidates: default
Vim on/off, default folder-collapse, theme, sidebar width, editor width). Likely
collects the existing `brulion:` preferences behind one dialog.

### M17 — Mobile UX
**Goal:** make Brulion usable on a phone/tablet, where there is no Ctrl, no
keyboard chords, and Vim is impractical. Touch-first affordances for the actions
currently bound to shortcuts (find/create, sidebar, formatting), a responsive
layout for the narrow viewport, and graceful absence of the keyboard-only features.
Larger and cross-cutting — likely its own cluster of phases.

## Later / backlog (out of MVP, on purpose)

Everything concrete is now scheduled in M5–M10 above. What remains here is
deliberately unscheduled — needs product-market-fit or a real demand signal first.

- **Workspaces** — `?ws=diablo`, multiple folder handles per origin in IndexedDB.
- **Sync (paid)** — BYO-cloud (Dropbox/Drive/OneDrive) via OAuth PKCE,
  client-side, no data hosted by us. License validation via merchant-of-record
  (Lemon Squeezy / Paddle). Not before product-market-fit.

## Open decisions

See `DECISIONS.md` for settled ones. Nothing currently open for M1 —
the framework, save strategy, default note name, and permission flow are all
settled there.
