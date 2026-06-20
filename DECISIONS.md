# Brulion — Decisions log

ADR-lite. One entry per decision: *what* and *why*. Newest at the bottom.

## Editor engine: CodeMirror 6, not Tiptap/ProseMirror
The product's moat is file fidelity — plain markdown the user owns, no lock-in.
In CodeMirror the document *is* the markdown text; decorations only hide and
style it, so there is **no serialization round-trip** and zero fidelity risk.
Tiptap/ProseMirror keep a rich document model and serialize to markdown on save:
the round-trip is idempotent-after-normalization (rewrites `*` → `_`, `-` → `*`,
drops hard wraps) and **silently drops anything outside the schema** — real
data-loss risk for a quick-capture tool. CodeMirror is more bare-bones but more
flexible, which we want for the bespoke editor in M3.

## No auto-naming; user names notes
The user names their own notes and adds them when they want. One default seed
note `start` (`start.md`). (Rejected: auto-name from first line; "open first
`.md` in folder" — there is no meaningful "first".)

## `start.md` is created on first save, not on open (M1, Phase 4)
The editor always works on `start.md`: if it exists, its content is loaded; if
not, the editor opens an empty buffer and the file is written to disk only on
the **first save** (autosave or Ctrl+S). Nothing is written to the user's folder
merely by opening it — a file appears only when the user actually captures
something. This supersedes the earlier "seed created only when the folder is
empty": "on first capture" is more precise, never litters someone's existing
notes folder with an empty `start.md`, and treats empty and non-empty folders
uniformly. (Rejected: create-on-open-when-empty — leaves a non-empty folder
without `start.md` as a dead-end in M1; always-create-on-open — litters any
opened folder.)

## Links are out of MVP
A `papier` gap and a genuine differentiator, but the real pain is quick-capture,
not graph navigation. Links are separable work (parsing, path resolution,
navigation) that could swallow the project before the core ships. Deferred.

## Editor UX: hidden syntax + slash commands, no toolbar
Markdown markup should never be visible; text reads as rich content. Reshape a
line with slash commands (`/h1`, `/clear`, …); format across multiple lines via
a right-click popup. No button toolbar — not Windows 95. (This is M2 work.)

## Editor experience before multi-note
M2 is the editor experience, M3 is multiple notes (swapped from the initial
order). A good editing experience is the actual advantage over `papier` and the
reason the product is worth building; multi-note is plain UI on a done
foundation and can wait.

## Hosting: GitHub Pages, zero backend
Static frontend on GitHub Pages — https satisfies the secure-context requirement
for the File System Access API, zero cost, zero servers. Update = `git push`;
user data is untouched because it lives on their disk.

## UI framework: none for M1 (vanilla TypeScript)
CodeMirror is framework-agnostic, so the framework question is only about UI
state ergonomics — and M1 has almost no UI state (one "Open folder" button plus
the editor mount). Real note state (list/switch/delete) is M3, by which point
the project may have a different shape; choosing a framework now is premature
optimization for a problem we don't yet have. So M1 is plain TypeScript owning
the DOM, no runtime. Adding Preact (~3 kB, React-like API) or Solid/Svelte later
is cheap and local — the editor stays untouched — so we defer the decision to
M3, when UI state actually starts to hurt. (Open: revisit at M3.)

## Project tracking: markdown in the repo
`ROADMAP.md` (direction, milestones, scope) + `DECISIONS.md` (this file) live in
the repo — version-controlled, survive closing the chat, congruent with the
product's own "plain files you own" ethos. GitHub Issues for granular execution
tracking once the repo is pushed. GSD deferred (too much ceremony for a solo
weekend project); the `spec` skill is for later, when designing the concrete
shape of a specific milestone.

## Files are the interface; the app is one view, not the owner
The deeper framing of the moat: the markdown files in the folder **are the API**
(Unix philosophy — a dumb shared format as the integration layer, tools around
it interchangeable). Capture is pluggable: many tools may write to the same
folder (an AI session, a CLI, vinote, a native global-hotkey helper), all
equivalent because the contract is just "a file in the folder". Brulion is one
*view* onto that folder, not the data's owner. This is why the next decision
(conflict handling) is a design requirement, not a nice-to-have.

## Save strategy: guarded debounced autosave (M1, Phase 4)
Quick-capture wants zero friction, so saving is **debounced autosave** (~600 ms
after the last keystroke) plus a flush on `blur`/`visibilitychange` (closes the
data-loss window between the last keystroke and the debounce). `Ctrl+S` also
forces an explicit save. All three paths funnel into one `save()`. Crucially,
every save first checks the on-disk file's `lastModified` against what we last
read: if it changed under us (another writer touched it), we **do not silently
overwrite** — we surface the conflict. Naive autosave without this guard would
clobber external edits and break the file-fidelity moat. (Rejected: explicit-
save-only — too much friction for quick-capture and easy to forget.)

## External edits & conflict handling is its own milestone
Because the folder has many writers (see "Files are the interface"), the app
*must* tolerate files appearing/changing from outside — watch/poll
`getFile().lastModified`, refresh the view, and resolve conflicts. This is a
first-class requirement, not a pitfall, so it deserves real design rather than a
bolt-on in the de-risking milestone. M1 ships only the cheap stale-write guard
(above) to prevent silent data loss; the full watch + conflict UX is a separate
milestone (moat-relevant, a candidate to pull earlier than its slot).

## Folder permission re-grant flow (M1, Phase 3)
The directory handle is persisted in IndexedDB (`idb-keyval`). On reload we call
`queryPermission({ mode: "readwrite" })` silently: if `granted` (e.g. via
Chrome's persistent "allow on every visit" grant) the user goes straight to
their note with zero clicks; otherwise we show a single "Resume folder access"
button whose click calls `requestPermission()` (the FSA API requires a user
gesture — we do not try to work around its absence).

## Testing: vitest units + Playwright e2e (OPFS-backed FSA)
Two layers. **vitest + happy-dom** (`src/**/*.test.ts`) covers pure logic and
DOM glue with the File System Access API mocked — fast, runs in `npm run build`'s
verification. **Playwright + real Chromium** (`e2e/**/*.spec.ts`, `npm run e2e`)
covers what happy-dom can't: real CodeMirror, real IndexedDB, and the real FSA
read/write/list/save paths — reached by stubbing `window.showDirectoryPicker` to
return an **OPFS** handle (`navigator.storage.getDirectory()`), a genuine
`FileSystemDirectoryHandle` that supports `getFileHandle`/`createWritable`/
`values`. The only surface no automation can drive is the **native OS folder
picker and the real permission prompt** (not DOM) — that stays a one-time manual
spot-check per FSA-touching phase. (Chromium browser binary is ~115 MB, not
committed; `npx playwright install chromium` provisions it.)

## No underline support (M2)
Markdown has no native underline. CommonMark reads `__x__`/`**x**` as **bold**
and `_x_`/`*x*` as *italic*; the only way to render a true underline is to write
raw `<u>…</u>` HTML into the file. That dirties the "clean markdown you own"
moat: the file stops being portable plain prose and starts carrying
presentation-only HTML that other markdown tools render inconsistently (or
escape). For a quick-capture notepad whose entire value is file fidelity, that
trade isn't worth one rarely-needed inline style. So **`Ctrl+U` is not bound**
and underline is not offered anywhere (no slash command, no context-menu item).
Consequence for the UI: the formatting surfaces expose bold / italic / inline
code / headings only. (Rejected: write `<u>` HTML — breaks the moat;
repurpose `__` as underline — collides with CommonMark bold and would corrupt
files round-tripped through other tools.)

## Hidden syntax: always hide, never reveal on the cursor line (M2)
The rendering engine hides markdown markup on **every** line, including the line
the caret is on — there is no Obsidian-style "reveal the raw `**` when you enter
the node". Rationale: the ROADMAP's explicit goal is "markup never visible, no
flicker", and always-hiding is also *simpler* — decorations rebuild only on doc
and viewport changes, not on every selection move. Hidden markup runs are made
**atomic** so the caret steps over the invisible characters cleanly instead of
landing inside them. Editing formatting is therefore done through the shortcuts /
slash / context-menu transforms, not by hand-editing raw markers. Consequence:
the editor reads as rich text at all times; the cost is that you can't
click-and-retype a raw `*` mid-word — you toggle via a command instead, which is
the intended Notion-like model. (Rejected: reveal-on-cursor-line — the explicit
"no flicker" non-goal, and forces selection-driven decoration rebuilds.)

## One set of pure transforms behind every formatting surface (M2)
Bold/italic/code toggles, heading-level cycling, and "clear to paragraph" are
implemented once as **pure functions** on `(text, selection) → (text,
selection)`, with no editor or DOM dependency. The keyboard shortcuts (Phase 2),
slash commands (Phase 3), and right-click popup (Phase 4) are all thin adapters
that call the same functions. This keeps the file-mutating logic in one
unit-tested place (the part where a bug means a corrupted file), so the three
input methods can't drift apart in how they edit the markdown. Consequence: the
heavy correctness testing lives in fast vitest unit tests; the e2e layer only
checks that each surface is wired to the transforms and renders hidden.

## Curated extension set instead of `basicSetup`; native browser selection (M2)
CodeMirror's `basicSetup` bundles `drawSelection`, which paints a **custom**
selection layer using `coordsAtPos`. With our `Decoration.replace` runs hiding
the markup, that layer mismeasured: every position after a hidden run was placed
~its width too far right, so the selection highlight drew offset from the text
(visibly covering the wrong word). The browser's **native** selection, measured
against the real (post-decoration) DOM, is correct. So we drop `basicSetup` for a
hand-picked set — `history`, `autocompletion` (the slash menu rides on it),
`highlightSpecialChars`, `defaultKeymap`/`historyKeymap`/`completionKeymap`,
`lineWrapping` — deliberately **without** `drawSelection` (native selection wins)
and without the code-editor chrome a prose notepad doesn't want (line numbers,
gutters, fold, bracket matching, close-brackets, active-line highlight,
default-highlight coloring). Consequence: selection/caret are the browser's own
(correct over hidden ranges), the editor looks like prose not code, and we own
exactly the extensions we use. (Rejected: keep `basicSetup` and patch
`drawSelection` — no clean way to disable one bundled extension, and the custom
layer is the bug; CSS-hiding markers instead of `replace` — leaves them
selectable/measurable and pollutes copied text.)

## Slash trigger: line start or after whitespace (M2)
The slash menu first triggered only when `/` was the very first thing on a line.
That made it feel broken — you couldn't reach it after typing anything on the
line. It now opens when `/` sits at a **line-start or post-whitespace boundary**,
so it works anywhere you'd naturally start a command, while a `/` inside a word
or URL (`and/or`, `http://`) still does nothing. Accepting removes **only** the
`/command` token (it starts the completion at the `/`, not the line start) and
reshapes the remaining line, so surrounding text is preserved — fixing an earlier
bug where accepting could wipe the row. (Rejected: trigger on every `/` — would
fire inside URLs and `and/or`; keep line-start-only — the original too-narrow
behavior the user rejected.)

## UI framework: still none for M3 (vanilla TypeScript) — decision settled
The M1 entry deferred the framework choice to M3, "when UI state actually starts
to hurt". It doesn't yet. M3's entire UI state is a list of note names plus which
one is active — a flat array and one selected key, re-rendered on three discrete
events (open folder, create, delete) and a click. That's a dozen lines of
imperative DOM, not a reactivity problem; a runtime (Preact/Solid/Svelte) would
add a dependency, a build wrinkle, and a second mental model next to the
CodeMirror-owned editor for no real ergonomic win. The lean ethos says take the
simplest thing that holds. So M3 stays plain TypeScript owning the DOM. The
escape hatch is unchanged: the editor is framework-agnostic, so introducing a
runtime later (if note state grows tabs/search/drag-reorder) stays cheap and
local. (Rejected: adopt Preact now — premature for list+active-key state;
the cost lands before the benefit.)

## A note is a `.md` file in the folder root; the filename is the name (M3)
Multiple notes are just the folder's `*.md` files — no index file, no metadata
sidecar, no database. The folder listing is the single source of truth, which is
the moat: the user's notes stay portable plain files that any other tool reads
and writes identically, and Brulion claims no ownership over them. Consequences:
listing a folder = enumerating `*.md` (sorted case-insensitively); the note's
**name is its filename**, shown in the UI without the `.md` extension for a
cleaner read while the file on disk keeps it; creating/deleting a note is exactly
creating/deleting a file; notes live in the **root** only (no nesting in M3 —
lean). The seed note stays `start` (`start.md`), created on first capture per the
existing FEAT-0004 decision. (Rejected: a `.brulion/index.json` or frontmatter
registry — faster listing and free ordering/metadata, but it's a second source of
truth that drifts from the files and dirties the folder with app-private state,
breaking the "files are the interface" moat.)

## Detect external edits by polling `lastModified`, not a watch API (M4)
The folder has many writers (see "Files are the interface"), so Brulion must
notice files appearing/changing/disappearing from outside while it's open. The
detection mechanism is **polling**: on an interval re-list the folder's `*.md`
and re-stat the active note's `getFile().lastModified`, comparing against what
the controller last saw. We deliberately do **not** use `FileSystemObserver`
(the real file-watch API): it's experimental, Chromium-only and recent, and
behind differing availability — leaning on it would narrow where Brulion works
for a feature whose whole point is robustness. Polling `lastModified` works
everywhere the File System Access API itself works, is a few lines, and is
plenty for a quick-capture notepad over a handful of small files. The poll loop
never overlaps its own runs (a tick still in flight is skipped) and runs through
the controller's existing serialize queue so it can't interleave with
open/switch/save. Consequence: external changes show up within one poll interval
(~a couple seconds), not instantly — an acceptable trade for portability and
simplicity. (Rejected: `FileSystemObserver` — experimental and non-portable;
no detection, rely only on the save-time guard — leaves the app showing stale
content and only ever reacts at save time, never reflecting additions/removals.)

## Brulion is a view: the disk wins when there's nothing to lose (M4)
The common case — an external tool edits a note you're *not* mid-editing, or
adds/removes a note — is not a conflict, it's just the world moving. In that case
Brulion silently tracks the disk: the list refreshes and, if the active note
changed on disk while the buffer has **no local unsaved edits**, the buffer
reloads from disk and the known `lastModified` updates. No prompt, no friction —
that's what "the app is one view, not the owner" means in practice. A prompt only
appears when tracking the disk would *destroy unsaved work* (the conflict case
below). Consequence: with Brulion open, the folder behaves like a live view of
what's actually on disk, matching the moat. (Rejected: prompt on every external
change — friction for the 99% non-conflicting case and trains the user to dismiss
the very prompt that matters when it's a real conflict.)

## Conflict UX: two-way choice (keep mine / take theirs), no diff (M4)
When an external change to the active note collides with **local unsaved edits**
— detected proactively by the poller or reactively by the save-time stale-write
guard — both paths converge on one conflict state with one resolution UX: **Keep
my version** (overwrite the on-disk file with the buffer, re-basing on its
current mtime) or **Use the version on disk** (discard local edits and reload).
The same UX covers the active note being *deleted* externally mid-edit (keep-mine
re-creates it; take-theirs moves off it). We do **not** build a diff or
three-way merge view: it's a large amount of UI and logic for a weekend-scale
quick-capture tool, and the moat only requires that we never *silently* clobber —
a clear two-way choice satisfies that. Both options are non-destructive to the
other side until the user picks; nothing is written or discarded behind their
back. This also replaces M1's dead-end conflict state (editing froze with no way
out) with real recovery. Consequence: the formatting/editing surface gains a
conflict banner with two buttons; resolving either way clears the state and
re-enables saving. (Rejected: diff/merge UI — too heavy for the ethos and the
audience; auto-pick a winner — silently loses one side's data, breaking the moat.)

## The conflict is modal: resolve before doing anything else (M4)
A conflict (FEAT-0015) demands a conscious choice — keep mine / take theirs — so
the banner is **modal**: while it stands, a full-screen backdrop covers the app
(list, editor, header), the editor is **read-only**, and the controller refuses
the navigation that would re-point the editor (`switchTo`/`addNote`/`removeNote`
are no-ops while `conflict`). The only exits are the two resolution buttons; the
backdrop does not dismiss on a background click or Escape. Rationale: the earlier
non-modal banner let the user click another note and thereby *silently* abandon
the conflicted, unsaved buffer (an unconscious "take theirs" reachable by a stray
click) — which breaks the moat's promise that we never lose the user's work
without their say-so. Making it modal forces the decision to be deliberate. The
banner-clearing is still centralized in `load` (it fires `onConflictResolved`
when it clears a standing conflict), but with navigation blocked the only path
that reaches it during a conflict is `resolveTakeTheirs`. Consequence: while a
conflict is open you cannot type, switch, create, or delete — you must pick keep
or take first; UI-wise the workspace dims behind the dialog. (Rejected: non-modal
banner you can navigate away from — silently drops unsaved edits on a stray click;
blocking navigation but leaving the editor writable — a leaky modal where you keep
typing into a buffer you're about to resolve.)

## Switching notes flushes the open note first (M3)
When the user picks another note, the controller flushes the currently open
note's pending edits **before** loading the new one, reusing the same guarded
`save()` as autosave/blur/Ctrl+S. Switching is just another moment the open
buffer might have unsaved keystrokes, so it funnels through the one save path
rather than inventing a second. Consequence: clicking away from a note you were
typing in never drops the tail of your typing, and the no-silent-clobber guard
still applies to that final write. The active note is persisted in IndexedDB
(`brulion:active`) so a reload returns to the note you were last editing (falling
back to `start` / the first note if it's gone). (Rejected: switch without
flushing and rely on the debounce — loses the last <600 ms of edits on every
switch; track active note in the URL — premature, and workspaces/URL state are a
later concern.)

## Block constructs render through a separate whole-doc StateField (M5)
FEAT-0016 renders fenced code, blockquotes, and unordered lists with their markup
hidden. The inline renderer (FEAT-0006) is a viewport-scoped `ViewPlugin`; block
rendering lives in a separate whole-doc `blockRenderingField` (`blockSyntaxRanges`).
Originally the field was *forced*: an early code-block design collapsed the fence
lines (replacing a line break), which CodeMirror forbids from a ViewPlugin — only a
StateField may emit layout-changing decorations. The M5 review then changed the
code-block look (see the next entry) so nothing crosses a line break anymore, which
removed that hard constraint — but the field stays anyway, because keeping block
rendering whole-doc lets it style *every* line of a block in one pass, and keeping
it separate from the hot inline plugin is clean. Consequence: two rendering layers
in `markdown-render.ts` — a viewport plugin for inline/heading marks (the frequent,
perf-sensitive case) and a whole-doc field for the three block constructs (rare,
small, so a full scan is cheap). Both are pure-read; bytes are untouched. (Rejected:
folding block rendering back into the viewport plugin now that it's legal — more
churn for no gain; the field already works and isolates the block logic.)

## A fenced code block renders as a full-width box, fences emptied in place (M5)
Decided in the M5 review (the first cut — a tight background span behind only the
body text — looked cramped). The block now reads as one full-width rounded box:
each fence's text is hidden *in place* (the fence line stays as an empty, styled
row — the box's top/bottom padding) rather than collapsed, and **every** line of
the block (fences + body) carries a `cm-code-block` line decoration, with rounded
corners on the first/last row. Because nothing is collapsed, no hide crosses a line
break, so the line decorations anchor reliably at real line starts (the earlier
collapse approach merged the first body line into the fence line and made line
decorations silently fail — which is why that cut used a span; moot now). Consequence:
a code block looks like a proper grey, padded, rounded code box spanning the column
width. (Rejected: collapsing the fence lines for a tighter box — reintroduces the
line-merge/anchor problem and the user preferred visible padding; a span behind the
text only — looked cramped.)

## Unclosed fenced blocks stay fully visible (M5)
A fenced block is only collapsed once it has *both* fences. While the user is still
typing the opening ```` ``` ````, nothing is hidden — mirroring the FEAT-0006 rule
that a bare `#` stays visible until a space completes the heading. Consequence:
the ```` ``` ```` you are typing never vanishes into a blank line before you've
closed the block; the collapse happens the moment the closing fence is typed.

## Clear Formatting strips all rendered markup, but not ordered lists or fences (M5)
FEAT-0017 makes "Clear formatting" / `/clear` remove every inline mark
(bold/italic/inline code) and block prefix (heading, blockquote, unordered-list
marker) the editor renders — not just the heading level it used to reset. Stripping
is driven by the parsed syntax tree (the marker nodes), never a character scan, so
nested marks fully unwrap and a `*` inside `**` is unambiguous. Two things are
deliberately left intact: **ordered-list numbers** (`1.`, not part of the FEAT-0016
rendered set) and **fenced-code fences** (removing them would reflow multi-line code
into prose — a destructive structural change, not a formatting reset). Both menu and
slash route through one transform (`clearFormatting`/`clearFormattingRanges`).
`/clear` strips the line *after* removing its own token (parsing the de-tokened line
in isolation), so typing `/clear` before a block marker can't hide that marker from
the parser. Consequence: the escape hatch the UI advertises now actually returns any
styled line to plain text; code blocks and numbered lists survive a clear.

## Enter continues a blockquote/list prefix — pre-existing, left as-is (M5)
While verifying FEAT-0016 we confirmed that pressing Enter inside a blockquote or a
bullet list carries the `>`/`*` prefix onto the next line (e.g. `> a` + Enter →
`> ` on the new line). This is the markdown language's indentation behavior
(`insertNewlineAndIndent` over the `markdown()` grammar), present since M1's editor,
not introduced by the block rendering. It is reasonable quick-capture UX (continue
the construct), so it is left in place; it only complicated a naive multi-construct
e2e test, which was rewritten to not fight it. Noted here so it isn't re-investigated
as a rendering bug. (No change made.)

## Distinct bullet glyphs and left-aligned block markers (M5 review)
Decided in the M5 review. Two list/quote rendering choices:
- **`*` and `-` get different glyphs** — `*` renders as a filled disc `•`, `-` as
  an en-dash `–` (CSS `::before`). Markdown often mixes the two markers in one file;
  distinct glyphs let the reader tell which was used at a glance.
- **Markers align with the text's left edge, no left overhang.** The first cut used
  a negative `text-indent` so the bullet hung into the left margin, left of normal
  text — which read as misaligned. Now the list glyph and the blockquote bar start
  exactly at the normal-text left edge (no negative indent), and the content flows
  to their right. Consequence: lists and quotes line up cleanly under surrounding
  paragraphs instead of poking out to the left.

## Enter continues and exits lists/quotes; the language keymap is taken over (M5 review → FEAT-0018)
The M5 review asked for "exit on double-Enter": Enter should continue a list/
blockquote, and on an empty marker line remove the marker and drop to a plain line.
`@codemirror/lang-markdown` ships `insertNewlineContinueMarkup`, but its empty-item
handling is uneven — a tight list converts to a *loose* list (inserts a blank line)
instead of exiting unless you pass `nonTightLists: false`, and a blockquote only
exits after *two* empty quoted lines. To get one uniform "empty marker line + Enter
= plain line" for both, we wrap it: `continueOrExitMarkup` clears the whole line when
it is just a marker (`isEmptyMarkerLine`), else delegates continuation to the library.
The empty-line test ignores the caret column because the hidden marker is an atomic
range that snaps the caret to the line start. Crucially, `markdown()` installs its own
**Prec.high** Enter/Backspace keymap by default, which *shadowed* our binding (Enter
kept doing the library's loose-list thing); we pass `addKeymap: false` and wire Enter
(our command) and Backspace (`deleteMarkupBackward`, kept for parity) into the editor
keymap ourselves, after `completionKeymap` so the slash menu still accepts on Enter.
Consequence: a nested empty item exits all levels at once (the whole line clears) —
simpler and uniform, chosen over the library's one-level-at-a-time peel. This is
really an M6 "editor comfort" item pulled forward because it bit during the M5 review.
(Rejected: `nonTightLists:false` alone — fixes lists but not quotes; binding at
Prec.highest to beat the language keymap — fragile precedence juggling vs. just turning
the language keymap off.)
