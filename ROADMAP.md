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

## Later / backlog (out of MVP, on purpose)

- **Conflict diff/preview** — when the conflict dialog (M4 / FEAT-0015) appears,
  show *what* changed (your version vs the on-disk version) so "use the version
  on disk" isn't a blind choice. M4 ships the lean two-way pick with no diff;
  this is the follow-up the user asked for. Separate work: a diff view and the
  UI to present both sides.
- **Subfolders in the notes folder** — let the folder be nested instead of flat
  (M3 deliberately kept notes root-only). Needs recursive listing, a tree UI in
  the sidebar, name/path handling, and a think about how create/delete and the
  M4 poller behave across nesting.
- **Collapsible note list** — let the user hide/show the left sidebar (the note
  list) to get a distraction-free, editor-only view; remember the state.
- **Vim mode** — a Vim keybinding layer for the editor (CodeMirror has
  `@replit/codemirror-vim`); opt-in, must not fight the slash/format commands.
- **Links** between notes (a `papier` gap and a differentiator, but separate
  work: parsing, path resolution, navigation, missing-target handling).
- **PWA** — installable window/icon, `beforeinstallprompt`, offline via service
  worker.
- **Workspaces** — `?ws=diablo`, multiple folder handles per origin in IndexedDB.
- **Sync (paid)** — BYO-cloud (Dropbox/Drive/OneDrive) via OAuth PKCE,
  client-side, no data hosted by us. License validation via merchant-of-record
  (Lemon Squeezy / Paddle). Not before product-market-fit.

## Known rendering gaps (M2 hidden-syntax, to fix)

The M2 editor hides/styles inline marks (bold, italic, inline code) and headings,
but several markdown constructs aren't rendered as rich content yet — they show
their raw markers. Reported from real use; each is a candidate fix (likely
`markdown-render.ts` decorations and, for clear-formatting, `markdown-transforms.ts`).

- **Clear Formatting skips inline code** — "clear to paragraph" doesn't strip a
  code span (text between `` ` ``). Audit whether it also misses other inline/block
  marks while fixing.
- **Fenced / multi-line code blocks** (```` ``` ````) don't render correctly.
- **Blockquotes** (`> quoted text`) don't render — the `>` shows literally.
- **Unordered lists** (`*` and `-` bullets) don't render — the marker shows
  literally instead of a list item.

## Open decisions

See `DECISIONS.md` for settled ones. Nothing currently open for M1 —
the framework, save strategy, default note name, and permission flow are all
settled there.
