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

> **Execution order (next up), agreed with the user.** M-numbers are **stable
> identities, not the running order**. M1–M13, **M14**, **M15**, **M16**, **M17**,
> **M19**, **M20**, **M21**, **M22**, **M23**, **M25**, **M27**, **M28**, **M30**,
> **M31**, **M32**, and **M33** are done. Next, in priority:
>
> the rest as capacity allows: **M26** (table rendering), **M29** (editable code-fence
> markers), **M18** (light/dark theme), **M24** (scroll/caret preservation on external
> refresh). **M30** (command palette + action bar), **M31** (weekly journal
> navigation — day-log deferred), **M32** (link section anchors), and **M33**
> (multiple vaults / workspaces) are done.
>
> (The user's own pain-ranking: rename + note-URLs + link-autocomplete first, then
> the search-ranking and frontmatter/copy irritants; settings, sidebar comfort,
> highlighting, theme, the scroll-jump fix and mobile come later. **M25**
> — keeping links consistent when a note is renamed — was pulled in during the M14
> review: the user values vault consistency over the manual-fix-up status quo, so it
> sits right after link-autocomplete in the link-domain cluster.)

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

- **Follow-up (from the M23 review): highlight the expanded frontmatter as YAML.**
  The expanded `---…---` region (M23) is plain editor lines today; once this
  milestone wires per-language highlighting, paint that region as YAML on the same
  infrastructure. Still decoration-only and opaque (colors tokens, never
  interprets fields) — consistent with the M23 moat stance.

### M16 — Settings modal
**Goal:** a single home for preferences — real new appearance settings plus the
relocated Vim toggle. Stored in **a file in the open folder** (`.brulion.json` at
root) so settings travel with the vault across machines/OSes; no idb cache, no
"defaults vs current" concept. The note list and the M4 poller must ignore this
non-note file. Scope agreed with the user (see the milestone-review notes).

In:
- **Font** — pick from installed fonts (`queryLocalFonts()`, one-time permission,
  Chromium-only — consistent with our FSA-only stance) and build an **ordered font
  stack** with CSS-style fallback; a generic family is auto-appended so there is
  always a floor across OSes. When font-access is unavailable/denied, fall back to
  a small curated preset list — never free-typing font names.
- **Text size** — px stepper (~12–24); H1/H2/H3 are relative multipliers baked into
  the theme (one base knob, hierarchy scales proportionally).
- **Editor width** — three presets: Narrow (current default) / Wider / Full.
- **Vim toggle** — moved here from the header; the visible header button is removed.
  The `Ctrl/Cmd+;` toggle shortcut (FEAT-0021) stays unchanged.
- **Entry point** — a gear icon in the header + `Ctrl/Cmd+,`.

Out (deliberately): theme (split to **M18**), sidebar width (M13, set by drag),
default folder-collapse (a sidebar behavior, not appearance).

### M17 — Mobile UX
**Goal:** make Brulion usable on a phone/tablet, where there is no Ctrl, no
keyboard chords, and Vim is impractical. Touch-first affordances for the actions
currently bound to shortcuts (find/create, sidebar, formatting), a responsive
layout for the narrow viewport, and graceful absence of the keyboard-only features.
Larger and cross-cutting — likely its own cluster of phases.

### M18 — Light/dark theme
**Goal:** a real light/dark (and possibly system-follow) theme, surfaced as a
preference in the M16 settings modal. Net-new feature, not just a relocated
toggle: today there is a single editor theme in `editor.ts`. Editor-only — the
on-disk markdown is unchanged. Split out of M16 deliberately so the settings
modal can ship on typography + Vim first; the theme picker slots into the same
modal when this lands.

> The milestones below (M19–M24) come from a review of real daily-use
> annoyances. For the agreed running order across all of M13–M24, see the
> **Execution order** note at the top of this section.

### M19 — Note URLs / history
**Goal:** give every open note its own URL so browser Back/Forward becomes
prev/next navigation over visit history, and the URL is a self-bookmark of state.
One mechanism covers both "go back to the note I came from" and "bookmark this
note". URL-only, moat-neutral — no change to file behavior.
- Each note open pushes a **hash route** `#/path/to/note` (no `.md`,
  URL-encoded segments) via the History API; path-addressed, consistent with the
  existing storage.
- Browser Back/Forward (and the mouse back button) navigate visit history for
  free — no custom shortcut, no custom history stack.
- On load/bookmark, resolve the note from the hash once the folder is granted;
  fall back to the normal first-run flow when no folder/permission yet.
- Note: in an installed PWA (M9) browser Back/Forward chrome may be hidden — in-app
  buttons are a *maybe*, deferred to M9, not here.

### M20 — Link autocomplete
**Goal:** suggest note links while typing, reusing the existing search ranking.
Follow-up to M8 (links); editor-only, no change to file behavior.
- Trigger on `[[`; a fuzzy-filtered list of existing notes, ranked by the **same
  `note-search.ts` scoring** as the Ctrl+K switcher (one source of truth).
- Built on `@codemirror/autocomplete`; Enter/Tab inserts `[[path]]` and closes `]]`.
- **Existing notes only** — no create-on-miss; typing a new name is allowed and
  becomes a dangling link (M8 already handles missing targets).

### M21 — Search ranking & recency
**Goal:** fix the switcher ranking (real reported failure) and add recency, both in
`note-search.ts`. Pure logic; no change to file behavior.
- **Ranking fix.** Two compounding flaws today: (1) the first-match gap penalty
  equals the leading distance, so deep paths (`Allegro/Journal/Week/2026-06-22`)
  are punished for folder depth; (2) greedy left-to-right matching grabs the first
  occurrence of each query char, so a clean contiguous run (`06-22`) is never found
  as contiguous. Fix: a literal contiguous substring **wins** (ranked by where the
  run sits — segment-start > mid-token), stop being greedy (best alignment, not
  first), and score against name/segments rather than the flat path so depth costs
  nothing.
- **Recency = most-recently-*visited*** (reuses the M19 visit history — free; not
  disk mtime). On an **empty query** the list is ordered most-recent-first (often
  no typing needed to switch to a nearby note). On a **non-empty query** match
  quality rules and recency is only a **tiebreaker** for equal scores — never a
  term added to the score (so a freshly-touched poor match can't jump a great one).

### M22 — Copy fidelity
**Goal:** copying a selection must yield well-formed markdown that reproduces the
formatting *visible in the selection* — fixing loss at selection boundaries.
Editor/clipboard layer; the on-disk file is untouched.
- Today copy returns only the source that falls *inside* the selection, so hidden
  boundary markup is dropped: selecting from a heading's visible text omits the
  leading `# ` (paste is no longer a heading); a selection starting/ending inside
  a bold span drops one/both `**` (lost formatting or malformed markdown).
- Fix: a custom copy/cut handler re-serializes the **selection** (never more than
  selected) to valid markdown — **line markers** (`#`, `>`, list) pulled in for a
  partially-selected line; **inline markers synthesized around the fragment** at a
  boundary (select half a bold word → `**half**`). Copy the selection, not the
  "snagged construct".

### M23 — Frontmatter (visual)
**Goal:** stop a leading `---…---` frontmatter block from rendering as ugly raw
code at the top of the note. **Visual only** — moat-critical that we do NOT touch
the bytes.
- Detect a leading frontmatter block and render it as a discreet, collapsed
  "metadata" region (expand to view/edit the raw text); it stays plain text in the
  document.
- **Opaque** — no field interpretation (`title`/`tags`/`aliases` deferred; `title`
  especially collides with the filename-as-identity model and M14) and **no
  parse-and-reserialize** (that would churn quoting/order/indentation and other
  tools would notice). Decorate rendering only; bytes unchanged.

### M24 — Scroll/caret preservation on external refresh
**Goal:** when the M4 poller reloads a note changed on disk, stop the view from
jumping to the top (and stop losing the caret). Editor/refresh layer.
- Reload by applying a **minimal diff** (longest common prefix + suffix; replace
  only the middle — no library) as targeted CodeMirror `changes`, instead of a
  wholesale document replace.
- CodeMirror then maps the **selection/caret** through the change automatically;
  the viewport anchor (top visible position) is mapped via `tr.changes.mapPos` and
  scrolled back — so the view holds the *same text* even when edits landed above it.
- Shares the diff infrastructure with **M7** (conflict diff/preview); coordinate.

### M25 — Update references when a note is renamed
**Goal:** keep the vault consistent across a rename — links in *other* notes that
point at the renamed/moved note follow it, instead of silently dangling. The M14
follow-up agreed in that milestone's review: rename (FEAT-0034) deliberately moves
only the one file; this milestone closes the loop on inbound links. In the links
domain (M8); follow-up to link-autocomplete (M20).

This is **not** a moat violation — rewriting a link is still plain markdown the
user owns, and it happens only on an explicit, user-initiated rename — but it is a
real multi-file write with genuine edge cases, so it gets its own spec/test/review
cycle rather than riding along with M14.

In:
- On rename, scan the vault for links targeting the old path and rewrite them to
  the new one. Handle all three link forms M8 produces — **markdown relative**
  (rebased when the note changes folder), **markdown root-relative**, and
  **wikilinks** (basename vs slashed) — each of which breaks differently under a
  rename vs a folder move.
- **Show which files will change** and write through the existing per-note
  conflict guard (never clobber a file edited out from under us); a rename that
  touches N files must not lose an edit in any of them.
- Reuse the existing resolvers (`resolveNotePath`/`resolveWikilink`) so the
  "what does this link point at" logic stays a single source of truth.

Out (for now): a global rename-any-note (not just the active one) surface; undo of
a multi-file rename.

> M26–M28 below come from a later round of real daily-use observations
> (after the M19–M24 batch). Unscheduled for now — slot into the execution
> order at the top when they go active.

### M26 — Table rendering
**Goal:** a leading-pipe markdown table (`| a | b |` + the `|---|` separator row)
renders as a real aligned table, not raw pipes and dashes. Same spirit as M5
(rendering gaps) and M15 (highlighting): **visual only** — moat-critical that we
do NOT touch the bytes. Likely CodeMirror decorations in `markdown-render.ts`.

In:
- Detect a contiguous table block (header row + separator + body rows) and render
  it with aligned columns and cell borders; honor the separator's alignment hints
  (`:---`, `:--:`, `---:`).
- Stays plain pipe-delimited markdown in the document; decorate rendering only,
  bytes unchanged — consistent with the M23 frontmatter stance.
- Editing UX (how the cursor behaves inside a rendered table, whether cells stay
  editable in place vs. revealing raw on the active row) decided at spec time.

### M27 — Settings & header polish
**Goal:** two small follow-ups to the M16 settings modal, both from real use; no
change to file behavior.

In:
- **Move "change folder" into Settings.** Relocate the folder-switch action out of
  the header into the M16 settings modal, so the header stays lean and folder
  switching lives with the other preferences.
- **Better settings icon.** The current M16 entry-point glyph doesn't read as a
  gear; swap it for an icon that clearly says "settings" (a real gear, or a
  cleaner alternative). Pure icon swap; the `Ctrl/Cmd+,` shortcut is unchanged.
- **Consistent icon set (from the M27 review).** Adopt a tree-shakeable icon set
  (**Lucide**) for the header instead of one-off hand-authored SVGs, convert the ☰
  sidebar toggle to the same family, and normalize the header buttons to one
  height. Header chrome only; no file-behavior change.

### M28 — Mermaid diagram rendering
**Goal:** a fenced ```` ```mermaid ```` code block renders as the diagram it
describes, instead of showing the raw Mermaid source. Same family as M5 (rendering
gaps), M15 (code highlighting), and M26 (tables): **visual only** — moat-critical
that we do NOT touch the bytes. The diagram source stays a plain fenced code block
in the file; we decorate how it paints.

In:
- Detect a fenced block with the `mermaid` info string and render the parsed diagram
  in place (CodeMirror decoration / widget), the source preserved verbatim on disk.
- Editing UX (cursor inside the block, reveal raw vs. rendered on the active block,
  what to show on a parse error) decided at spec time — consistent with M26's "raw
  on the active line" question.
- **Dependency weight is the open question.** Mermaid is a large library; pulling it
  into the main bundle fights the lean, fast-loading, offline-PWA stance. Likely a
  **lazy/dynamic import** so the engine loads only when a note actually contains a
  Mermaid block (and the editor stays instant for notes that don't) — settle the
  loading strategy and the offline-cache implications at spec time.

Out (for now): a Mermaid *authoring* aid (live preview pane, snippet menu); this is
render-on-display only, like the other M-rendering milestones.

### M29 — Reveal code-fence markers when editing inside
**Goal:** make a fenced code block's markers editable. Today (since M5/FEAT-0016) the
opening ```` ```lang ```` and closing ```` ``` ```` lines are **always** hidden, so a
typo in the fence or its info string (e.g. ```` ```mermiad ````, or changing
```` ```js ```` → ```` ```ts ````) can't be fixed in place. Surfaced during the M28
review. Editor-only, no file-behavior change.

In:
- When the selection/cursor is **inside** a fenced code block, stop hiding the fence
  lines — reveal the backticks + info string so they're editable; re-hide on the way
  out. The same reveal-on-selection pattern links already use; the change lives in
  `markdown-render.ts` (`blockSyntaxRanges`). Applies to **all** fenced blocks
  (Mermaid benefits for free — revealing a diagram then shows its ```` ```mermaid ````).

> M30–M33 come from a later round of real daily-use observations. Unscheduled for
> now — slot into the execution order at the top when they go active. M30 is the
> foundation M31 builds on.

### M30 — Command palette + customizable action bar
**Goal:** a keyboard-first way to run *actions* (not just open notes), and a
configurable top bar. A command palette — same overlay pattern as the M12 Ctrl+K
note switcher, likely sharing its infrastructure — lists the available **actions**
(go to a note, change folder, toggle Vim, …) for fuzzy-search + run. Actions are a
first-class concept: each can be **pinned to the top bar** (configured in the M16
settings) and given an **icon** (from the M27 Lucide set) shown both on its toolbar
button and in the palette. Existing header controls (folder switch, Vim toggle)
migrate onto this action model. Pure UI/UX over existing capability; no file-behavior
change.

In:
- An action registry (id, label, optional icon, run()) and a palette overlay that
  fuzzy-searches and runs them (keyboard nav, like the switcher).
- A settings surface (M16) to choose which actions are pinned to the top bar and in
  what order; the bar renders those as icon/label buttons.
- Reframe the current folder-switch (M27) and Vim toggle as registered actions.

### M31 — Journaling: week-note navigation + quick day-log
**Goal:** make the weekly-journal workflow one keystroke. Builds on M30 (actions) and
M16 (settings). Two coupled parts (may split into phases):
- **Templated week-note navigation** — a settings field holds a date-templated path
  with a placeholder, e.g. `Allegro/Journal/Week/{mondayOfTheWeek}`; an action
  resolves the placeholder against the current date and opens that note (creating it,
  with the week template, if missing).
- **Quick day-log** — an action that appends a log entry to the **current week note's
  matching day section**, which implies a defined **weekly-note structure** (per-day
  headings) the template seeds and the append targets.

Out (for now): a general per-note-type template system; this is scoped to the weekly
journal until a second use appears.

### M32 — Link section anchors (`#anchor`)
**Goal:** support a section anchor in a note link — `[text](note#section-title)` and
the wikilink equivalent — resolving to the target note **and** scrolling to that
heading. Extends M8 (links); reuses the existing resolvers, adds anchor parsing and a
scroll-to-heading step. Moat-neutral (still plain markdown links).

### M33 — Multiple vaults / workspaces
**Goal:** make working across several folders painless — promotes the backlog
"Workspaces" item, pulled forward by real friction. Two parts:
- **Switch between granted folders** — keep the set of previously-granted folder
  handles (already in IndexedDB) and offer quick switching between them (a palette
  action / settings list), instead of re-picking via the native picker each time.
- **Per-window vault identity** — two windows open on two vaults currently share one
  origin-global handle in IndexedDB, so a refresh can swap a window to "the other"
  vault. Give each window a stable vault identity (e.g. a `?ws=` URL param, à la the
  backlog Workspaces sketch) so a reload re-attaches to the *same* vault and the two
  windows stay independent.

## Later / backlog (out of MVP, on purpose)

Everything concrete is now scheduled in M5–M10 above. What remains here is
deliberately unscheduled — needs product-market-fit or a real demand signal first.

- **Rich-text copy + paste** — a `text/html` clipboard flavor so copy keeps
  formatting into rich targets (Docs/Word) and paste converts HTML → markdown. The
  two directions are **one coupled problem** (copy-RT without paste-RT is half a
  bridge); parked until there's real demand. Distinct from M22, which only fixes
  plain-markdown copy fidelity.
- **Workspaces** — `?ws=diablo`, multiple folder handles per origin in IndexedDB.
  **Now scheduled as M33** (switching between granted folders + per-window vault
  identity), pulled forward by real friction.
- **Sync (paid)** — BYO-cloud (Dropbox/Drive/OneDrive) via OAuth PKCE,
  client-side, no data hosted by us. License validation via merchant-of-record
  (Lemon Squeezy / Paddle). Not before product-market-fit.

## Open decisions

See `DECISIONS.md` for settled ones. Nothing currently open for M1 —
the framework, save strategy, default note name, and permission flow are all
settled there.
