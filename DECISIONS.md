Warning: truncated output (original token count: 59181)
Total output lines: 3278

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

## Bullet rendered as a replace-widget, not hide-plus-`::before` (M6 → FEAT-0019)
The M5 bullet rendering hid the `*`/`- ` marker run (atomic, zero-width) and drew the
glyph with a line `::before`. Because the `::before` glyph (`•  ` with trailing
spaces) and the hidden run have different widths, the caret and the bullet drifted
apart *while the marker was being typed* — typing a bare `*` showed the caret one
space in while the document was still just `*`, so the next char landed before the
`*`, which popped back to the line start. Fix: render the bullet as a
`Decoration.replace({ widget })` over the whole `* `/`- ` run (a fixed-width
inline-block `.cm-bullet`), and only once a trailing space completes the marker
(the same bare-`#` rule headings already use). The widget occupies the marker's
document range, so the caret maps around it and stays in sync with the glyph; a bare
marker stays a literal visible char. Consequence: the `.cm-list-disc/-dash::before`
glyphs are gone, replaced by a `BulletWidget` (disc for `*`, en-dash for `-`); the
on-disk bytes are still untouched (display-only). The marker run is kept atomic, so
the FEAT-0016 AC-7 "caret steps over the marker" behavior is preserved.

## Sidebar collapse: idb-keyval + a CSS class orthogonal to `[hidden]`, Ctrl+\ (M6 → FEAT-0020)
Three choices for the collapsible note list:
- **Persist via the existing `idb-keyval` layer** (`brulion:sidebar-collapsed`), not
  a new `localStorage` path. The sidebar is revealed only *after* the async
  folder-restore, so there is no first-paint flash that a synchronous read would
  avoid — keeping one persistence mechanism (folder handle, active note, and now
  this) is leaner than introducing a second store.
- **Collapse is a CSS class on `.workspace` (`sidebar-collapsed`), separate from the
  `#sidebar[hidden]` attribute** that already encodes folder-open. The two are
  orthogonal: toggling never touches `hidden`, and a collapsed sidebar stays hidden
  by CSS even after a folder opens. Consequence: opening a folder no longer forces
  the list back into view if the user collapsed it.
- **The toggle lives in the header (not in the sidebar) and Ctrl+\ drives it.** It
  must stay reachable when the sidebar is gone, so it can't live inside it. Ctrl+\
  has no CodeMirror/editor binding, so a window keydown listener catches it after it
  bubbles past the editor — no clash with the format/slash/Enter shortcuts.

## Vim mode: a precedence-first compartment, eagerly loaded, behind an opt-in toggle (M6 → FEAT-0021)
Opt-in Vim (`@replit/codemirror-vim`), off by default, persisted in `idb-keyval`
(`brulion:vim`). Key decisions:
- **Wired through a CodeMirror compartment placed FIRST in the extensions array.**
  First = highest precedence, so the Vim plugin's keydown handler runs before our
  keymaps. The library binds Enter, Ctrl+B/E/I only in *normal* context, so in insert
  mode they fall through to our slash/format/markdown-Enter commands unchanged, while
  in normal mode Vim owns them (the point of opting in). Verified by e2e in a real
  browser, not just by reasoning. With Vim off the compartment holds `[]`, so the
  config is byte-identical to before — no Vim artifacts for the default user.
- **Eagerly imported, not lazy-loaded.** The library adds ~140 kB to the bundle even
  though most users never enable Vim. A dynamic `import()` would shave that off the
  common path but makes `setVimMode` async and the toggle more complex. For a static
  site (cached after first load) and the weekend-scale lean ethos, the simpler
  synchronous eager import wins; bundle size is not the moat. Revisit if startup cost
  ever bites.
- **The two-state toggle mechanics were generalized.** FEAT-0020's `wireSidebarToggle`
  became a shared `wireToggle(button, { initialOn, apply, onChange })` used by both
  the sidebar and Vim toggles, so the aria-pressed + persist-on-flip logic isn't
  duplicated. Pure refactor — FEAT-0020 behavior and its tests are unchanged.

## Correction: the M2 selection offset was `scrollbar-gutter`, not `Decoration.replace` — drawSelection restored (M6 review → FEAT-0021)
The M2 decision above ("Curated extension set … native browser selection") blamed
`drawSelection` mismeasuring **after hidden `Decoration.replace` runs** and dropped
it for the browser's native selection. That diagnosis was wrong. Opting into Vim
surfaced it: `@replit/codemirror-vim` hides the native selection to draw its own, so
with no `drawSelection` the visual-mode selection was invisible. Investigating
(measuring `coordsAtPos` and the `drawSelection` rectangles against the native
selection) showed:
- `coordsAtPos` is **accurate** over hidden-markup runs (Δ=0) — the hidden
  `Decoration.replace` runs were never the problem.
- The whole offset came from **`scrollbar-gutter`** on `.cm-scroller` (added to keep
  the centered column from shifting when a scrollbar appears). `stable both-edges`
  shifted `drawSelection`'s layer ~15px and blew out the right edge; even one-edge
  `stable` broke the right edge; only removing the gutter (`auto`) made
  `drawSelection` pixel-perfect, hidden markup and all.
Fix (chosen over band-aiding Vim only): **remove `scrollbar-gutter`, restore
`drawSelection` editor-wide, and drop the native-selection workaround.** Selection
is now correct everywhere and visible under Vim, with one selection mechanism.
Consequence/trade: the centered text column may shift slightly when a vertical
scrollbar appears (the reason the gutter existed) — accepted; can be addressed
later another way if it bothers. Lesson: the M2 fix treated a symptom; the real
cause was a layout property, not the decorations.

## Conflict preview: read-only `@codemirror/merge` side-by-side, not a hand-rolled diff (M7 → FEAT-0022)
M4 shipped the two-way keep/take conflict choice (FEAT-0015) but deliberately
deferred showing *what* differs — so "use the version on disk" was a blind
choice. M7 fills that gap: when the conflict modal stands, show your buffer
beside the on-disk file, with the changes highlighted, so the pick is informed.
Key decisions:
- **Diff via `@codemirror/merge`'s `MergeView`, not a hand-written line diff.**
  It is the official CodeMirror-family diff component, so it reuses our editor
  theme/extensions and renders a proper change-highlighted view for free. A
  hand-rolled LCS line diff would be more code for a worse, unthemed result. The
  ~modest bundle cost is fine for the same reason Vim's was (static, cached site;
  bundle size is not the moat).
- **Read-only, side-by-side, mine on the left / disk on the right** — matching
  the button order (Keep my version | Use the version on disk). The preview never
  edits anything; resolution still goes through the controller's existing
  `resolveKeepMine`/`resolveTakeTheirs` on the serialize queue, re-basing on live
  disk state per FEAT-0015. Display-only: no new bytes touch the file (the moat).
- **`onConflict` carries the two versions: `{ mine, theirs }` with `theirs: null`
  meaning deleted on disk.** `raiseConflict` became async and reads the disk file
  (via `readNote`, whose `lastModified === null` cleanly signals "deleted") at
  raise time, so the modal has both sides to render. When deleted, the disk pane
  shows empty content under a "(deleted on disk)" label; the keep/take semantics
  are unchanged (keep re-creates, disk switches off).
- **The MergeView is built fresh per conflict and destroyed on resolve**, mounted
  into a container inside the existing `#conflict-backdrop`. Conflicts are rare
  and each carries different content, so a persistent instance buys nothing.

## A note's identity is its folder-relative POSIX path, not a bare filename (M8 → FEAT-0023)
M3 settled "a note is a `.md` file in the folder **root**; the filename is the
name". M8 lifts the root-only restriction: a note is now any `.md` file anywhere
in the picked folder tree, and its identity is its **folder-relative POSIX path**
(`projects/diablo.md`). This stays true to the moat for the same reason the flat
case did — the folder *tree* is the single source of truth, no index file, no
sidecar, no app-private state; the on-disk directory structure *is* the data
model. Consequences: `listNotes` recurses the tree and returns sorted relative
paths (forward-slash separated, regardless of OS); `readNote`/`saveNote`/
`statNote`/`createNote`/`deleteNote` resolve a path by walking
`getDirectoryHandle` per segment (with `{ create: true }` on the write paths so a
note materializes its folders); the controller carries the active note as that
path string (it was already opaque to it), and the active-note persistence,
poller, and conflict guard all key off the path unchanged. `normalizeNoteName`
becomes path-aware: it splits on `/`, validates each segment with the existing
unsafe-character/empty rules, **rejects `.` and `..` segments** (no escaping or
re-anchoring the root — the moat must not let a note write outside the folder the
user granted), and re-joins to `folder/name.md`. The user-facing display still
drops `.md`; the tree (FEAT-0024) shows each segment. (Rejected: keep a flat list
and fake folders via a separator in the filename — lies about the on-disk shape
and breaks the "files are the interface" moat; a path index/manifest — a second
source of truth that drifts from the tree.)

## Links are standard CommonMark inline links to local `.md` files, not wikilinks (M8 → FEAT-0025)
The moat is plain markdown the user owns, portable to any other tool. Wikilinks
(`[[note]]`) are an Obsidian-family extension, **not** CommonMark — another tool
reading the file would render the literal `[[note]]`, not a link. So M8 uses
**standard markdown inline links** — `[text](relative/path.md)` — which every
markdown tool resolves identically. This is the same reasoning that rejected
`<u>` underline in M2: never write a non-portable construct into the user's
files. The link target is a folder-relative path to a local `.md` note, resolved
relative to the **linking note's own folder** (POSIX join, `..` allowed in a link
only insofar as it stays within the picked root). Rendering follows the
hidden-syntax model: the `[`, `](path)` markup is hidden and `text` is styled as
a link; **Ctrl/Cmd+click follows it** (a mouse modifier, so it never fights the
slash/format/Vim keybindings), switching the editor to the resolved note. A
missing target renders as broken (distinct style) and following it offers to
create the note at that path. `http(s)://` targets open in a new browser tab and
are never treated as in-app note navigation. Display-only: the file keeps the
literal, portable markdown-link bytes. (Rejected: wikilinks — non-portable, dirties
the moat; plain left-click to navigate — hijacks normal caret placement in an
editor; a custom link autocomplete / backlink graph — separable, PMF-gated, and
links were nearly cut from the MVP entirely.)

## Folder tree derived fresh from the listing; collapse persisted; no "new folder" action (M8 → FEAT-0024)
The sidebar renders the flat path list (FEAT-0023) as a nested tree. Key choices:
- **The tree is derived every render by a pure `buildNoteTree(paths)`, not
  stored.** The on-disk folder tree is the single source of truth (the moat), so
  the UI tree is a pure projection of `listNotes`'s output — no index, no cached
  tree that could drift. `buildNoteTree` lives in `ui.ts` (exported, unit-tested)
  rather than a new module: it is one small pure function, and the repo already
  keeps pure cores beside their glue (`classifyDiskCheck` in `note-controller`,
  the range builders in `markdown-render`). A new module would be ceremony.
- **Folders collapse; the collapsed-path set persists via `idb-keyval`**
  (`brulion:collapsed-folders`, stored as an array), matching how the sidebar
  (FEAT-0020) and Vim (FEAT-0021) preferences persist — one storage mechanism, no
  new path. Toggling flips the children's visibility in place and writes the set;
  it does not rebuild the list.
- **Ancestors of the active note always render expanded**, regardless of the
  persisted collapsed set, and without mutating it. So creating `sub/x` (or
  reloading onto it) can never leave the active note hidden behind a folder the
  user previously collapsed — the persisted state is honored for every *other*
  folder. (Rejected: respect collapse literally even for the active note's
  ancestors — hides the note you just made; auto-uncollapse and persist that —
  silently forgets the user's collapse.)
- **No standalone "new folder" button.** A folder exists exactly when a note
  path puts a note in it (`folder/name` in the new-note field, already handled by
  FEAT-0023's path normalization + folder materialization), and disappears when
  its last note is deleted. This keeps the folder set a pure consequence of the
  files — nothing to bookkeep, nothing to drift. (Rejected: an explicit new-folder
  action — would create empty folders the listing can't represent, a second kind
  of state outside the files.)

## Link interaction: plain-click follows, modifier-click edits, bare URLs autolink (M8 review → FEAT-0026)
FEAT-0025 shipped only the link *mechanism* — `[text](url)` rendered, Ctrl/Cmd+click
to follow. The M8 review found that too thin and undiscoverable. The review settled:
- **Plain click follows a link; Ctrl/Cmd+click places the caret instead.** The
  editor always reads as rich content, so a link should behave like a link — a
  plain click follows it (external → new tab, internal → switch/create). The
  inverse, Ctrl/Cmd+click, is the *edit* escape hatch: it places the caret in the
  link (you can't otherwise, since plain click now navigates). This flips
  FEAT-0025's modifier-to-follow. The cursor signals the mode: `pointer` over a
  link normally, a text caret while Ctrl/Cmd is held (a window keydown/keyup
  listener toggles a class). (Rejected: keep modifier-to-follow — undiscoverable,
  the original complaint.)
- **Bare web URLs autolink; emails do not.** A typed `http(s)://…` or `www.…`
  renders as a clickable external link (the GFM Autolink parser extension, without
  pulling in tables/strikethrough/tasklists). The parser also recognizes bare
  emails, but the renderer leaves those as plain text — the user didn't want
  addresses silently turning into `mailto:` links. `www.` opens as `https://www.…`.
  (Rejected: only `http(s)://` — half-measures surprise more than help; autolink
  emails too — unwanted.)
- **A link reveals its raw markdown when the caret is within it** — a deliberate,
  scoped exception to the M2 "always hide, never reveal on the cursor line" rule.
  The exception is justified because a link's hidden part (the URL/target) is
  *content* you must edit, not presentation noise like `**`. Entered via the
  Ctrl/Cmd+click caret placement above; leaving the link re-renders it. This
  reintroduces selection-driven decoration rebuilds for the link layer only, which
  is fine (and the flicker is desirable — you want to see the URL while editing
  it). A **hover tooltip shows the link's target** as a lighter "where does this
  go" preview. (Rejected: a popup link editor — a new widget and interaction model;
  kept in reserve if caret-reveal proves insufficient.)
- **External links open via a real anchor click, not `window.open(_, _, "noopener")`** —
  the features-string form opens a popup window rather than a tab in some browsers.

## Reversal: wikilinks ARE supported, by the user's call in the M8 review (M8 → FEAT-0027)
FEAT-0025 recorded "no wikilinks — not CommonMark, other tools render `[[ ]]`
literally, keep the files portable." The M8 review **overrode** this: the user
wants wikilinks, and owns that moat trade. The reasoning that changed the call:
`[[note]]` is a de-facto standard across the plain-markdown note ecosystem
(Obsidian, Foam, Logseq, vinote, many static-site generators), and for the
quick-capture niche it is *more ergonomic* than a full `[text](path.md)` — you
type a name, not a path. The portability cost (a non-CommonMark tool shows the
literal `[[…]]`) is the user's accepted trade for that ergonomics, not the
agent's to refuse. Decisions:
- **Syntax: `[[note]]` and `[[note|alias]]`** (alias is the standard pipe form;
  the label shows the alias, the link points at `note`).
- **Resolution: a bare name matches by basename across the whole tree,
  case-insensitively** (`[[DiaBlo]]` finds `projects/diablo.md`) — the low-friction
  point of a wikilink; a name containing `/` is a root-relative path
  (`[[sub/note]]` → `sub/note.md`). An ambiguous bare name (two same-named notes
  in different folders) resolves to the first by sorted path — deterministic, and
  rare at quick-capture scale.
- **Missing target → broken + create.** A wikilink with no matching note renders
  broken (`cm-link-broken`) and following it creates the note: a bare name at the
  **root** (`name.md`), a slashed one at that path. Reuses FEAT-0026's
  plain-click-follow / reveal-on-caret.
- **Detected by a scan, not the CommonMark tree** (the parser doesn't know
  `[[ ]]`), and resolved at render time against the link context so the broken
  styling and the follow target are computed from the real folder. Wikilinks carry
  the resolved/create note path in `data-note` (an absolute folder-relative path),
  distinct from a markdown link's `data-href` (resolved relative to the open note),
  so the follow handler switches/creates the path directly. Display-only: the file
  keeps the literal `[[…]]` bytes.

## PWA: a static manifest + committed icons, no build plugin (M9 → FEAT-0028)
M9 makes Brulion an installable PWA. The first phase is the install *metadata*: a
`public/manifest.webmanifest` (name, `display: standalone`, theme/background
colors, `start_url`/`scope` under the `/brulion/` Pages base, and 192/512 + a
maskable icon) plus the `<link rel="manifest">` / `theme-color` / apple-touch-icon
wiring in `index.html`. Choices:
- **The manifest is a hand-written static file in `public/`, not generated by a
  PWA build plugin.** Vite copies `public/**` verbatim to the build root, so the
  manifest ships unchanged under the base — no `vite-plugin-pwa`/Workbox dependency
  for what is a dozen lines of JSON. Lean ethos: the simplest thing that holds.
- **Icons are generated once from committed SVG sources** (`scripts/icon.svg`,
  `scripts/icon-maskable.svg`) via `rsvg-convert` (`scripts/gen-icons.sh`), and the
  resulting PNGs are committed. No image toolchain enters the build; the SVGs +
  script stay for regeneration. The glyph (a lined page on the brand accent
  `#9a3b2f`, surface `#fbfbfa` — the palette already in `styles.css`) has a
  full-bleed maskable variant so the installed icon isn't letter-boxed.
- **`start_url`/`scope` are the explicit `/brulion/`, not relative.** The base is
  fixed in `vite.config.ts`; an explicit value is unambiguous and unit-testable
  (a relative `.` couldn't be asserted to be "under the base"). Consequence: if the
  Pages base ever changes, the manifest must change with it — accepted, it's one
  place and the base is effectively permanent.
- **Moat untouched.** The manifest/icons are app chrome; nothing references,
  embeds, or caches the user's `.md` files. A vitest validates the shipped
  manifest, the referenced icon files, and the HTML wiring so the assets can't rot
  silently. (Installability isn't complete until the service worker — FEAT-0029;
  this phase is deliberately the metadata half.)

## PWA offline: a hand-rolled service worker, production-registered only (M9 → FEAT-0029)
The offline half: a `public/sw.js` that caches the app shell so the editor loads
with no network, tipping the app over the installability bar. Choices:
- **Hand-rolled worker, not Workbox / `vite-plugin-pwa`.** A few dozen lines of
  plain JS beat a build plugin + generated precache manifest for a static site with
  a single hashed JS/CSS bundle. Same lean reasoning as the manifest. The worker
  uses **runtime caching** (cache on first fetch), so there is no build-time
  precache list to keep in sync with hashed filenames.
- **Strategy split by request type: network-first for navigations, cache-first for
  assets.** The HTML document is fetched fresh online (so a redeploy is picked up
  on the next online load) and falls back to the cached shell offline; the
  content-hashed JS/CSS are immutable, so cache-first is always correct and a new
  deploy just fetches new URLs. `activate` prunes every non-current cache version;
  `skipWaiting` + `clients.claim` make an update take effect promptly. Cache writes
  go through `event.waitUntil` so they complete even if the page closes right after
  first paint.
- **Registered ONLY in production builds** (`import.meta.env.PROD`, via a
  `src/pwa.ts` helper). The Vite dev server serves unbundled modules + an HMR
  client the worker shouldn't cache, and gating on PROD keeps the dev-server e2e
  suite byte-identical to pre-PWA behavior (zero M1–M8 regression). The offline
  path is therefore verified against `vite preview` (a real production build) via a
  second Playwright `webServer`; `reuseExistingServer` is off on CI so the worker
  is never validated against a stale `dist/`.
- **Moat untouched — categorically.** The worker only handles same-origin GET
  requests for the app's own static output. The File System Access API does not use
  `fetch`, so the user's notes never enter the cache; there is no app-private copy
  of user data to drift from disk. (Rejected: caching/syncing the notes through the
  SW — that *is* the index/sidecar the moat forbids; a PWA build plugin — a
  dependency and a second mental model for a weekend-scale static site.)

## PWA install: a custom in-app Install button, not just the browser default (M9 → FEAT-0030)
With the manifest + offline worker in place Chromium fires `beforeinstallprompt`.
We capture it (`preventDefault` suppresses the browser's mini-infobar) and surface
our own **Install** button in the header rather than relying solely on the
address-bar install icon, which users routinely miss. Choices:
- **A pure `createInstallPrompt(isStandalone, setVisible)` controller + a thin DOM
  adapter in `main.ts`**, mirroring the FEAT-0020/0021 toggle split so the
  show/clear logic is unit-tested once and the wiring stays a few listeners. The
  button reuses the generic `header button` CSS — no new styles.
- **The deferred event is single-use.** A click fires `prompt()` once, then the
  stash is cleared and the button hides regardless of accept/dismiss (the event is
  spent after `prompt()`); if the browser re-fires `beforeinstallprompt` the button
  re-appears. (Rejected: restoring the button on dismissal — it would offer a
  prompt over a spent event.)
- **Hidden while already installed** (`display-mode: standalone` or iOS
  `navigator.standalone`) and before the event arrives. **Not production-gated**
  (unlike the SW): the wiring is harmless in any build and the synthesized-event
  path is e2e-testable on the dev server. Pure UI around a browser event — no
  files, no storage, the moat is untouched. iOS (no `beforeinstallprompt`) relies
  on the manifest + apple-touch-icon for manual "Add to Home Screen" — a guided
  iOS flow is out of scope.

## Welcome screen: an overlay over the workspace; the editor needs a folder (M10 → FEAT-0031)
Before a folder is open the app used to greet the user with a bare, blinking
editor and a lone header "Open folder" button. M10 replaces that with a first-run
welcome hero (name, pitch, the file-fidelity promise as a feature, and the
open-folder CTA). Decisions:
- **The welcome is an absolutely-positioned opaque overlay over `.workspace`**
  (`#welcome { position:absolute; inset:0; z-index:1 }`, with `.workspace`
  made `position:relative`), shown until a folder opens and hidden by a single
  tested `showWorkspace()` flip. The editor stays mounted behind it (CodeMirror is
  always instantiated) — the overlay simply covers it. (Rejected: a sibling
  swap that `display:none`s the whole workspace — more layout churn and it would
  also hide the always-mounted editor the smoke test checks; the overlay is the
  leaner pattern and the editor's first-paint cost is negligible.)
- **`#open-folder`/`#resume-access` moved into the hero; a separate header
  `Switch folder` button re-picks once a folder is open.** Both run the *same*
  `wireOpenFolder` flow — no reimplementation. The header is contextual: just the
  `Brulion` wordmark (+ the FEAT-0030 Install button when offered) before a folder,
  and the wordmark + `☰` + Vim + `Switch folder` after. The re-pick button is
  labeled "Switch folder" (not "Open folder") so it doesn't read as "no folder
  open" while one is.
- **The pre-folder editor is no longer an interaction surface — by design.** With
  no folder there is no note to edit, so the welcome gates the editor. This changed
  an *implicit* test contract: several e2e specs (rendering, bullet-caret,
  typography's column measure) had been driving the bare pre-folder editor as a
  harness. They now open a folder first (the real editing context), which is more
  faithful anyway. The reload-persistence specs (note, note-list, sidebar, vim)
  dropped their post-reload manual re-open: the folder **auto-restores** on reload
  (the remembered handle is still granted), so the manual click was stale — they
  now assert the welcome is gone and the state restored, testing the real
  auto-restore path. Pure UI throughout — no file behavior changed, the moat is
  untouched.

### M10 review fixes (live app)
Two issues surfaced reviewing the deployed app:
- **The header `☰` sat in the middle.** A stale `#toggle-vim { margin-left: auto }`
  (from FEAT-0021, when Vim was the rightmost control) collided with the new
  wordmark's `margin-right: auto`: two `auto` margins split the free space, so the
  sidebar toggle landed mid-header. Fix: drop the Vim rule — the wordmark's
  `margin-right: auto` alone now groups every control at the right edge.
- **The welcome screen flashed on reload before the workspace loaded.** The hero
  was shown by default, so on reload it painted for a beat before `restoreFolder`
  auto-reopened the folder and swapped to the workspace. Fix: a neutral **loading
  overlay** (`#loading`, a small spinner) is shown from first paint instead; the
  welcome (`hidden` by default) is revealed only once the restore check resolves
  with no folder, while an auto-restored folder goes straight to the workspace.
  So the first paint resolves to exactly one of loading → welcome (no folder) or
  loading → workspace (folder restored) — never welcome → workspace. Tracked by a
  `workspaceShown` flag set in `onListChanged`; the reload e2e specs assert the
  welcome stays hidden, guarding against a regression of the flash.

## Vim caret: snap out of hidden markup with a transaction filter, scoped to the Vim compartment (M11 → FEAT-0032)

**What.** With Vim on, the caret could rest on characters the editor hides (a
heading's `# `, a blockquote's `> `, a list `* `/`- ` marker). The default caret
already steps over these because CodeMirror's own motions honor the editor's
`atomicRanges`; the Vim plugin (`@replit/codemirror-vim`) computes motions by raw
character offset (`cur.ch ± n`) and never consults them, so `h`/`l`/`0`/`w`/… could
land inside an invisible run. Fix: a small `EditorState.transactionFilter`
(`src/vim-caret.ts`) that, on any selection-setting transaction, snaps an endpoint
that lands **strictly inside** a hidden run to the nearest edge — forward to the
run end when the motion advanced, back to its start when it retreated. The hidden
runs are computed from the **same pure functions the renderer uses**
(`markdownSyntaxRanges` / `blockSyntaxRanges`), scoped to the endpoint's line.

**Why this shape.**
- *Why a transaction filter, not patching Vim.* The Vim package exposes no
  per-motion hook and has dozens of motions (`h`/`w`/`b`/`0`/`$`/`f`/…); overriding
  each would be fragile. A filter post-corrects the *result* of any motion in one
  place, synchronously (no flicker, no dispatch loop).
- *Why reuse the renderer's range functions.* "What is hidden" then has a single
  source of truth. The view-scoped `EditorView.atomicRanges` facet (which the
  default caret consumes) is unreachable from a state-level transaction filter, so
  the guard can't read it directly — but by calling the same pure functions the
  atomic ranges are *built from*, a future change to hiding rules (a new inline
  mark, say) flows to both the renderer and the guard with no desync.
- *Why scoped to the Vim compartment, not always-on.* The first cut installed the
  filter unconditionally as a "shared invariant". The M11 code review flagged it:
  off-Vim the default caret is never inside a run, so the filter was a guaranteed
  per-keystroke no-op. It now rides inside the existing `vimMode` compartment
  (`editor.ts` `setVimMode`), so it exists only while Vim does — no cost on the
  common (Vim-off) path, and the code matches the feature's intent.

**Consequences.**
- *UI:* under Vim, horizontal motions land only on visible glyphs or at a run's
  edge (a heading caret may sit at the line start, which renders at the first
  visible character). No reveal-on-cursor — the markup stays hidden; the caret just
  doesn't sit inside it. The default caret, link click-reveal (the filter exempts
  `select.pointer` selections), slash/format/Enter commands, and visual selection
  are unchanged.
- *Scope held deliberately:* the filter skips document-changing transactions, so
  it governs the caret's **resting position after a motion**, not Vim
  operator/edit semantics (`d`/`c`/`x` trimming markup precisely) — those are out of
  scope for FEAT-0032. A known, accepted limit: an edit could in principle leave
  the caret inside a still-hidden run, but the natural cases self-correct (deleting
  toward a marker removes its trailing space, which un-hides it).
- *Moat:* untouched — the filter only corrects the editor selection; nothing is
  read from or written to the user's folder.

## Quick switcher: a Ctrl+K modal that finds or creates, replacing the sidebar textbox (M12 → FEAT-0033)

**What.** A `Ctrl+K` / `Cmd+K` modal overlay (`src/quick-switcher.ts`) fuzzy-finds a
note and opens it, or — when the query names no existing note — creates it. It
reads the in-memory note list and routes to the existing `switchTo` / `addNote`
operations. The old sidebar inline-create textbox (`#new-note` + `wireNewNote`) and
its `#status` error line are removed; the sidebar gains a small "Find or create
note…" button that opens the same switcher.

**Why this shape.**
- *One create surface.* The textbox was poor UX (a bare field, error-only
  feedback) and a *second* way to create alongside switching. Folding find + create
  into one palette (the classic quick-switcher pattern) removes the duplicate path
  and makes creation keyboard-first.
- *Hand-rolled fuzzy, no dependency.* `src/note-search.ts` holds a small pure
  `fuzzyScore` (subsequence match, contiguous/segment-start bonuses, gap penalty)
  and `searchNotes` (rank + create-eligibility). For tens-to-hundreds of notes a
  library would be dead weight against the lean ethos.
- *One pure module owns "what matches/creates".* Ranking and the
  "offer-create-vs-open" decision share inputs and must agree, so they live
  together; the switcher only renders the result and owns selection/highlight. The
  create-eligibility check reuses `normalizeNoteName` — the *same* validator
  `addNote` uses — so the UI decision and the actual create never disagree.
- *`create` = the query to attempt, not a pre-validated name.* So an invalid name
  still shows a Create row whose activation surfaces the validator's error inline
  (AC-7), and validation happens exactly once, at create time.
- *Capture-phase shortcut.* The `Ctrl/Cmd+K` listener is registered in the capture
  phase on `window`, so neither CodeMirror nor the Vim layer can swallow it first
  (AC-9). …29181 tokens truncated…
elapsed since. `POLL_RELIST_CONCURRENCY`'s sequential walk plus the abort checkpoints still apply
identically within a sweep — this is a genuinely additive change, not a replacement for them. A
vault small enough to finish inside one 400ms budget behaves exactly as before (a "sweep" that just
happens to complete on tick one, no user-visible change); a large vault instead pays ~400ms per
tick, spread across many ticks, rather than one multi-second walk — for any vault size, capping the
worst case "how much is in flight when I click" to roughly one budget's worth, not proportional to
the whole tree.
Staleness handling carries over unchanged in spirit: `sweepStartNotes` is captured once, when a
sweep *starts* (not re-captured on continuation ticks), and compared to live `notes` only once the
sweep *completes* — if something else (an addNote/removeNote/renameActive) refreshed `notes` more
recently, the sweep's result is dropped, `activeSweep` still clears (ready for a fresh attempt), and
the throttle clock still doesn't get bumped, so the very next tick starts over for real rather than
waiting out `FULL_RELIST_MS`.
Found and fixed a real bug in `continueSweep` while writing its first tests: the budget/abort check
was placed *before* recording an already-fetched entry, meaning an entry retrieved right at the
budget boundary was silently discarded rather than kept — a real vault would have quietly lost
files from the sidebar under just the wrong timing. Moved the check to *after* recording each
entry, so anything already paid for (a `next()` call that already resolved) is never thrown away;
only the decision to fetch the *next* one is gated. Confirmed via a resumption test (many small
budgets, accumulating results across calls) that failed clearly before this fix (missed roughly
half the tree) and passes after.
`checkDisk`/`probeDisk` deliberately left as a one-shot `listNotes` call, unchanged — still the
test-only detection seam the app itself never calls; no reason to add sweep complexity to a path
with no real behavior to protect.
Rewrote the `refreshFromDisk` test suite's mocking: `listNotes` is no longer called by this path at
all (it's fully replaced by `startSweep`/`continueSweep`/`sweepResult`), so every test that used to
configure `listNotes.mockResolvedValue([...])` to simulate "what the poll discovers" now configures
`sweepResult.mockReturnValue([...])` instead, with `continueSweep` controlling completion timing.
One new test (`note-controller.test.ts`) proves a sweep spanning three ticks stays as *one* sweep
(`startSweep` called once, `continueSweep` three times) and only applies its result once complete
— confirmed failing (three fresh sweeps instead of one resumed) against a mutation that dropped the
"don't restart an in-progress sweep" guard.
Not yet re-measured on the real device — the next `?debug` capture is what tells us whether this
was the actual remaining lever, or whether something else (the single in-flight scan itself, on
this particular phone, being inherently slow regardless of how little of the tree it covers) is the
true floor.

## The sweep confirmed itself on a real device — the next bottleneck was the loading screen, not I/O
A fresh `?debug` capture (after reloading — the first capture that day was accidentally against a
stale, un-reloaded tab still running pre-sweep code, a reminder that a deploy doesn't reach an
already-open tab) showed the sweep working as designed: `poll: sweep tick` entries at ~400-440ms
each, and every `readNote` for a note switch back in the ~65-140ms range with none of the
400-650ms outliers the last two rounds kept hitting. The remaining, *different* complaint the user
raised: first load of a large vault still feels slow, because the loading screen (and everything
behind it) doesn't lift until the *entire* listing finishes — 2.8-4.4s on this vault — even though
the guessed active note's own content is usually ready in under a second.
Root cause: `onListChanged` is the single callback that both (a) reveals the workspace / hides the
loading screen and (b) reports the confirmed note list — so revealing the UI was accidentally
coupled to the slowest part of `open()`, the part the speculative-read optimization was already
racing past.
Fix: added `onPreviewReady(path)` — fired from `open()` as soon as the speculative read settles,
strictly *before* the listing is known to have succeeded. `main.ts`'s handler reveals the workspace
and updates the header's note-name display, nothing else (no sidebar render, no route sync, no
recency tracking — those still wait for the real, confirmed `onListChanged`, since they depend on
the full `notes` list). Guarded with `if (workspaceShown) return` so this only fires the very first
time (page load) — a vault *switch* still waits for the real confirmation before touching anything
visible, since switching away from an already-working vault has more to lose than first paint does.
Two follow-on concerns, both handled:
- **Failure**: if the listing then fails (a dead vault), the previewed content must revert — the
  existing "editor unchanged on a failed open" guarantee, now also covering the case where a
  preview already painted over it. An `openFailed` flag guards against the speculative read
  resolving *after* the failure was already handled (it would otherwise paint over the revert).
- **Double-render**: when the guess turns out right (the common case), `activate()` would otherwise
  call `setEditorText` a second time with identical content — a redundant full-document replace
  (a stray undo-history entry, a wasted decoration rebuild). `load()` now skips the redraw when the
  buffer already shows the exact content about to be set — a small, generally-useful guard, not
  specific to previewing.
Four new tests cover: the preview firing (and the editor showing content) before the listing
settles; the revert on a failed listing; that a failed *speculative read* alone doesn't fire the
preview; and (via `vi.spyOn(view, "dispatch")`) that the right-guess case dispatches exactly one
buffer replacement, not two. Each confirmed failing against the specific behavior it protects
before being fixed. Measured on the 2018-note desktop benchmark: editor content visible at 218ms,
essentially tied with the 265ms full listing on desktop (where the listing itself is already fast)
— the real payoff is on the phone, where that listing was measured at 2.8-4.4s and the guessed
note's read alone takes well under a second.

## `open()`'s own initial listing is a sweep too — the sidebar no longer waits on the whole vault
The previous fix decoupled the *editor content* from the listing (`onPreviewReady`), but a real
`?debug` capture showed the *sidebar* still didn't render until the listing fully finished
(`open: listNotes: 2948.7ms`, `renderNoteList` only firing at t=3216ms) — the user's next complaint.
`open()` still called plain `listNotes(folder)`, a one-shot, run-to-completion walk; only
`refreshFromDisk` (the poll) had been migrated to the resumable `Sweep`.
Fix: `open()` now calls `startSweep`/`continueSweep(sweep, INITIAL_SWEEP_BUDGET_MS)` instead of
`listNotes`, with its own larger budget (800ms vs. the poll's 400ms tick — a real user is waiting
for *a* sidebar here, not just background upkeep). A vault that finishes within budget behaves
exactly as before (`notes`/`onListChanged` reflect the complete list, `lastFullListAt` reset).
A vault that doesn't finish commits whatever the sweep found *so far* as `notes` (so the sidebar
shows a real, if partial, list immediately) and hands the same `Sweep` object off to
`activeSweep`/`sweepStartNotes` — the exact fields `refreshFromDisk` already knows how to keep
advancing. The poll picks it up on its next 2s tick and keeps going in the background, completing
it in the same way it already completes a sweep interrupted by its own budget — no new machinery,
just `open()` becoming another producer of the same handoff. Once it completes, `onListChanged`
fires again with the full list, exactly like catching up on an externally-added note.
Found and fixed a related robustness gap while building this: `refreshFromDisk`'s `continueSweep`
call had no `try`/`catch` — a folder vanishing mid-sweep (an already-rare but real case: the vault
removed from disk while the poll happens to be mid-walk) would throw uncaught, and since nothing
cleared `activeSweep`, every subsequent tick would keep re-awaiting the same now-broken queue
forever. Added a `sweepThrew` flag alongside `sweepCompleted`; both now clear `activeSweep`/
`sweepStartNotes` so the very next due tick starts fresh instead of retrying a dead sweep. Confirmed
via a test that fails without the `|| sweepThrew` condition (the second, deliberately fresh
`refreshFromDisk` call never calls `startSweep` again, because the broken sweep is still "active").
While migrating, also caught and reverted an unintended side effect: an early draft had `open()`
set `lastFullListAt = Date.now()` on a *complete* sweep (reasoning: a fresh, full listing just
happened, no need to force another one right after) — but this quietly broke a pre-existing,
already-tested invariant that a freshly-opened folder always gets one verified relist on its very
first poll, regardless of the throttle window (see the original `open()`, which unconditionally set
`-Infinity`). That invariant existed for a real reason (a vault opened seconds ago could already be
stale from another process) and had 12 tests depending on it, several of which failed clearly once
reverted back to confirm the regression-catch actually works. Restored the unconditional
`lastFullListAt = -Infinity` after `open()` (whether the sweep completed or was handed off) —
scope discipline: this migration is about first-paint latency, not about re-litigating the
relist-throttle policy.
Test suite: every test that configured `listNotes.mockResolvedValue([...])` purely to control what
`open()` "discovers" now configures `sweepResult.mockReturnValue([...])` instead (the `open()`-only
`listNotes` mock calls that remain are exercising `addNote`/`removeNote`/`renameActive`'s own
still-real, unchanged `listNotes` calls — those were left as-is). Not yet re-measured on the real
device — the next `?debug` capture is what confirms the sidebar now populates progressively there,
the way the 2018-note desktop benchmark already showed it doing.

## The sidebar paints from a per-vault cached note list on attach — a hint, never authoritative
The follow-up real-device capture confirmed the sweep migration worked (`renderNoteList` at 1129ms
instead of ~3216ms, `setEditorText (preview)` at 480ms). The user's next question: since
`saveRecency`/`loadRecency` already cache a per-vault note list (its MRU order) in IndexedDB via
`session.ts`, why not cache the *whole* list too, paint the sidebar from it immediately on attach,
and let the real listing (via the sweep this session already built) correct it — same principle as
letting the automatic poll catch up on any external change, just applied to "we haven't looked yet
this session" instead of "something changed since we last looked."
Added `saveNoteList`/`loadNoteList` to `session.ts`, mirroring `saveRecency`/`loadRecency` exactly
(same per-vault key shape, same `[]` default). Deliberately kept out of `note-controller.ts`: the
controller already owns exactly one piece of cross-reload persistence (the active note, global, via
`saveActiveNote`/`loadActiveNote`) and has no notion of "vault id" at all — recency and expanded
folders are already main.ts-level, per-vault session concerns for the same reason, so this fits the
same seam rather than growing the controller's responsibilities or its public `open()` signature.
Wired into `main.ts`: `attachVaultNow` loads `cachedNoteList` for the vault being attached (alongside
`recency`/`expandedFolders`, including the same rollback-on-failed-attach snapshot). `onPreviewReady`
paints the sidebar from it — using the *guessed* active note (the `path` it's already given) as the
highlighted row — before the real listing is known to have found anything. `onListChanged` persists
the fresh, authoritative list back to the cache whenever it actually changes (`!listUnchanged`, same
gate already used for the recency touch).
Deliberately did **not** move the workspace-reveal gate to fire from cache alone (i.e., still gated on
`onPreviewReady`, which only fires once a real disk read has already succeeded): a dead vault (folder
deleted/moved since last visit) must never flash a stale sidebar with nothing live behind it, and
`open()` would then need new revert plumbing (undoing an already-shown workspace) that doesn't exist
today — the existing dead-vault guarantee only ever had to revert *editor text*, not *sidebar
visibility*. Painting the sidebar strictly inside the already-gated `onPreviewReady` callback keeps
that invariant: cache paints only happen once we know the vault is genuinely reachable.
Also fixed a related bug in passing: `onPreviewReady`'s early-`return` — meant only to skip
re-*revealing* an already-visible workspace — was gating the whole callback body, so a vault *switch*
(not just first load) never got any of this: the sidebar kept showing the *previous* vault's list
until the new vault's real listing landed. Split the cache-paint step out from under that guard so it
runs on every attach (first load and switches alike); only the reveal/`showWorkspace` call stays gated
on first-paint-only.
Refactored the three `renderNoteList` row handlers (`onSelect`/`onDelete`/`onToggleFolder`) out of the
inline object literal in `onListChanged` into a shared `noteListHandlers` const, since the cache-paint
call site now needs the identical handlers — one definition, not two copies to keep in sync.
Four new tests in `session.test.ts` mirror the `saveRecency`/`loadRecency` suite exactly (save under
the vault-scoped key, load it back, default to `[]`, keyed per vault) — confirmed each fails against a
deliberately mistyped key before being fixed. `main.ts` itself stays outside the unit test net (as
every other wiring change here has been) — verified via the full e2e suite instead.

## Folder create/delete + move: destination picker, no context-menu system, move reuses rename (M35)
M35 closes a real gap: the sidebar tree can list/select/toggle folders and
create/delete/rename **notes**, but there's no way to create/delete a
**folder**, or move a note/folder elsewhere. Scoped before any spec work, per
the survey of `note.ts`/`ui.ts`:
- **Folder create/delete get the same inline-button treatment notes already
  have** (a "+" to add a subfolder, a "×" to delete one) — not a new
  right-click context-menu subsystem. The tree has never had context menus
  (`context-menu.ts` is unrelated — a CodeMirror wikilink editor extension);
  building one just for two folder actions is more surface than the feature
  needs. (Rejected: right-click menu — a new interaction pattern and a new
  overlay/positioning problem for two buttons the row can hold directly.)
- **Deleting a folder is destructive and gets a mandatory confirm step** —
  unlike a note's one-click "×", a folder can hold an unbounded number of
  notes beneath it, so removing it can silently take real content with it.
  This is the one place in this milestone where the moat's "never lose data
  silently" principle applies directly.
- **Move is driven by a "Move to…" destination-picker overlay, not
  drag-and-drop.** DnD would need new pointer/touch machinery, reorder
  semantics, and a distinct accessibility story; a palette-styled picker
  (same visual family as the quick switcher) reuses an existing overlay
  pattern, works identically with keyboard/mouse/touch, and needs no new
  interaction model. (Rejected: drag-and-drop reordering — heavier to build
  and test, and mobile drag is exactly the kind of touch-fiddly interaction
  M17 flagged as a general risk.)
- **Moving a note is a generalization of the existing rename path, not a new
  primitive.** `moveNote` (`note.ts`) already resolves an arbitrary
  destination path (cross-folder capable, prefers the native
  `FileSystemFileHandle.move()`, falls back to copy-then-delete) and
  `renameActive` (`note-controller.ts`) already wraps it with flush + link
  rebase + reactivation — today only ever called with a same-folder target.
  P2 widens the destination it's called with; no new note-level FS
  operation. **Moving a folder is new** (`moveFolder`): walk the subtree via
  the existing `listNotes` infra, `moveNote` each contained file into the
  equivalent path under the new prefix (rebasing inbound links per moved
  note, exactly like a rename), then remove the emptied source folder tree.
  A folder move into its own subtree is refused (would orphan/self-nest).
- **Built on a feature branch, not shipped straight to `main`.** Unlike every
  prior milestone (spec → implement → review → verify/seal → push to
  `main`), M35 stays on `feature/folder-note-management` through the whole
  build — the user wants a live-tested staging pass before this lands, per
  the GitHub Pages staging discussion this session. `specman seal` and the
  usual commit trailers still apply per phase; only the final "ship" step
  (merge to `main`) is deferred to the milestone review.

## A folder's lifecycle is independent of its contents — empty folders are never auto-pruned (M35 → FEAT-0069)
First cut of `deleteNote`/`deleteFolder`/`moveNote` pruned any folder a
deletion/move left empty, to keep the pre-M35 illusion that "an emptied
folder disappears" (the behavior a real e2e regression, `subfolders.spec.ts`,
was written against back when folders had no independent existence at all).
A high-effort `/code-review` caught that this was actually wrong: pruning
can't tell "emptied by deleting/moving the last thing out of it" apart from
"the user explicitly made this with `createFolder` and it just doesn't have
anything in it yet" — both look identical on disk. So it silently deleted a
folder the user deliberately created the moment a note passed through it and
back out, directly contradicting this milestone's own point. **Fix: don't
prune at all.** A folder is now a real, independent filesystem object —
exactly like on a real OS, emptying it doesn't delete it; the user removes an
unwanted empty one explicitly via its own "×" (`deleteFolder`). Consequence:
within one browser session, a folder that only ever existed via **note-path
inference** (never explicitly created, e.g. materialized by `sub/note.md`)
still stops rendering the moment its last note is gone — nothing tracks it as
a "known folder" so there's nothing to resurface — matching the old,
already-tested behavior with no code change needed there. But a **leftover
empty directory** does resurface on the *next* vault attach (a fresh
`listFolders` walk sees whatever is really on disk) — an honest reflection of
real state rather than hiding it forever, and the cost of not pretending to
track something the app never actually modeled.

## `onFoldersChanged` is a separate, rare callback — not folded into `onListChanged` (M35 → FEAT-0069)
The same review flagged a second problem in the first cut: `onListChanged`
had been made `async` (to `await listFolders()` inline) so a freshly
created/deleted folder would show up — but every call site in
`note-controller.ts` still fires it fire-and-forget against its still-`void`-
typed signature, so two overlapping renders could resolve out of order and
leave the sidebar showing stale content. Worse, doing this **inside**
`onListChanged` meant *every* note add/delete/rename paid for a full
recursive directory walk just to look for empty folders, even though almost
none of those operations ever change folder existence — directly undermining
the `Sweep`/budget machinery built elsewhere in this codebase specifically to
bound relist cost on large vaults. Fix: `onListChanged` goes back to fully
synchronous (its original contract), and a new **`onFoldersChanged?:
(folders: string[]) => void`** fires only from `addFolder`/`removeFolder` —
the only two operations that actually touch folder existence — with the
listing computed there (naturally serialized through the controller's
existing queue, so two folder ops can't race each other either). `main.ts`
tracks the result in `currentFolders`, refreshed once per vault attach
(`openNote`, in parallel with the settings read) and on that callback; every
`renderNoteList` call site reads it, never re-fetching it itself.

## Reversal: drag-and-drop IS coming after all, additive to the picker (M35 → FEAT-0072)
P2's scope note picked "a destination picker, not drag-and-drop" — reasoning
that DnD needed new machinery (drag handles, drop-target feedback, a touch
equivalent) the picker got for free, and that keyboard/mobile reachability
mattered more than a mouse-only fast path. The milestone review overrode
this: the user wants DnD too. Per the same reasoning FEAT-0027 used when the
user overrode "no wikilinks" — this is the user's call to make about their
own moat/ergonomics trade, not the agent's to refuse a second time. Settled
as **additive, not a replacement**: the picker (and its context-menu entry
point, FEAT-0071) stays exactly as built — still the only way in for
keyboard and touch — and dragging a row onto a folder (or a root drop zone)
is a second, faster path for a mouse, calling the *same* underlying move
(`renameActive` after switching, or `moveFolder`) a picker pick would have,
including the same self-nest refusal. No new file-system operation; this is
purely a second trigger surface, same relationship P1/P2's buttons had to
P3's context menu before the review replaced them.

## New note in a folder reuses the quick switcher, seeded with a prefix (M35 → FEAT-0072)
Rather than inventing a second "type a name" prompt for folder-scoped
creation, a folder's "New note…" menu item opens the existing FEAT-0033
quick switcher with its input pre-filled `<folderpath>/` — the *same*
find-or-create mechanism every other note creation already goes through,
already handling duplicate detection; the user just continues typing the
leaf name. One creation path, one place `normalizeNoteName` validation lives,
consistent with FEAT-0012's own reasoning for reusing `createNote` rather
than a parallel folder-scoped variant.

## Reversal: native confirm/prompt/alert give way to in-app dialogs (M35 → FEAT-0073)
P1 through P4 all used `window.confirm`/`window.prompt`/`window.alert` for
delete confirmation, rename/new-folder naming, and move-failure feedback —
reasoning each time "match the pattern the pre-existing note delete already
uses, no new modal component." Flagged live, after testing the shipped
milestone, as the wrong call: the app already has a themed, animated overlay
family (quick switcher, command palette, move picker, conflict modal) native
dialogs ignore completely — they render in browser chrome, ignore light/dark
theme, and clash with the motion language M34 built. Reversed: a new
`dialog.ts`, mirroring `move-picker.ts`'s `mount(els)` shape over a
pre-declared `#dialog-backdrop`/`#dialog` pair, exposes `confirmDialog`/
`promptDialog`/`alertDialog`, styled like the existing `#conflict`/
`.settings-dialog` pair (same backdrop, motion, focus-restore, Escape/
outside-click dismissal) so it's one more instance of an established family,
not a new one. No controller/file-system logic changes — only the trigger
surface for confirmation/naming/feedback.

## Dropping onto a note row targets its containing folder, not a no-op (M35 → FEAT-0072 AC-9)
Live testing after P1-P5 shipped surfaced that dropping a note/folder onto a
note row did nothing (`blockDropBubbling` only prevented the drop from
bubbling to an ancestor zone — a note row was deliberately not a drop target
at all, on the reasoning that a note isn't a container). Reversed: a note
row is by far the easiest target to hit when the intent is "put this
alongside that note," so a drop there now redirects to the note's own
containing folder — the exact destination dropping directly on that
folder's header would give, reusing `wireDropTarget` unchanged, just with a
different computed destination. The self-nest refusal already used by
folder-header drops applies unchanged.

## Password-manager anti-autofill hints go on every text input, not just the one that was noticed (M35 → FEAT-0074)
The trigger was a single observation — Bitwarden offering to fill a blank
rename-dialog input — but the fix scopes to every plain text field in the
app (switcher, palette, move picker, dialog, header rename, journal path),
per the user's own framing ("the browser shouldn't suggest anything inside
Brulion's text fields"). `autocomplete="off"` alone doesn't reliably stop
extensions like Bitwarden, which by design override it for fields that look
like login prompts; the standard mitigation is the vendor-specific ignore
attributes (`data-lpignore`, `data-1p-ignore`, `data-bwignore`) plus a
generic `data-form-type="other"` hint, applied uniformly rather than
field-by-field as each one gets noticed.

## Rename is a distinct verb from Move, not a special case of the picker (M35 → FEAT-0072)
"Move…" already lets a destination equal the current parent (a no-op), so a
rename *could* have been "open the picker, pick the same folder, then also
prompt for a new name" — rejected as a clunky two-step for the single most
common file operation there is. Instead "Rename…" is its own menu item that
prompts for a bare name (mirroring "New subfolder…"'s prompt shape) and
recomputes the target by keeping the parent and swapping only the leaf
segment — `moveFolder`/`renameActive` underneath, unchanged; only what target
path gets computed is new.

## Reversal: the tree's context menu gets a keyboard path after all (M35 → FEAT-0071/AC-7)
FEAT-0071 explicitly deferred keyboard reachability ("mouse right-click and
touch long-press are the two paths in") — reasonable at the time, but a
high-effort code-review pass flagged it as a real accessibility gap: a
keyboard-only user had no way at all to delete, rename, or move a note or
folder once P3 replaced the old inline buttons with the menu. Reversed:
Shift+F10 / the keyboard's dedicated "Menu"/"ContextMenu" key opens the same
menu for whichever row has focus. No new focusability needed — a folder
header is already a `<button>`, and a note row's keydown bubbles up from its
own focusable name button — so `wireTreeMenu`'s existing per-row wiring
just gained one more event listener, not a new focus model.

## Reverted: gating moveFolder()'s source delete on createFolder's result (M35 → FEAT-0070)
A review pass flagged that `moveFolder` ignored `createFolder`'s result
before deleting an emptied (sub)folder, in theory losing it outright if a
like-named file blocked the destination. The fix (only delete once
`createFolder` reported `"created"`) broke a real, previously-passing
e2e test (AC-3, moving a folder with nested subfolders) — `moveNote`'s own
file writes and the subfolder-creation loop both auto-vivify ancestor
directories as a side effect, so by the time the top-level folder's own
`createFolder` call ran, the destination legitimately already existed for
reasons that had nothing to do with a conflict, and the fix couldn't tell
the two apart. Reverted rather than chasing a more elaborate fix: the actual
harm of the original gap is low (it only ever applies to a folder already
verified empty via `isFolderEmpty` — no note content is ever at risk, just
a rare, disk-external-tool-only edge case where an empty folder vanishes
without reappearing at the destination), too small to justify the
complexity a correct fix would need to safely distinguish "blocked by a
genuine conflict" from "already there because this exact move's own note
writes put it there."

## Round-5 review findings deliberately not acted on (M35 → FEAT-0070)
Three findings from a 5th `/code-review` pass were left as-is:
- The "Move…" picker's destination list (`destinationChoices`) doesn't
  filter out a folder's own subtree the way drag-and-drop's drop-target
  highlight does — picking it round-trips to a refusal message instead of
  never being offered. This is the exact, already-documented "Out of scope"
  decision in FEAT-0070's spec ("filtering the destination picker's folder
  list to exclude invalid targets up front... the operation is refused with
  a message if picked anyway, same pattern as an invalid/duplicate folder
  name") — not a new gap, a standing choice.
- `collect`/`collectFolders` (`note.ts`) duplicate the same semaphore-walk
  shape almost verbatim. A real DRY concern, but `moveFolder` has been the
  single most bug-prone area across all five review rounds on this branch —
  refactoring the directory-walk primitives underneath it at the tail end of
  this loop is more risk than the duplication currently costs.
- `moveFolder`'s per-note move loop awaits each `moveNote` sequentially
  instead of using the existing `Semaphore`-bounded concurrency `listNotes`/
  `listFolders` already use. A real perf win for a folder with many notes,
  but the loop's ordering already carries several hard-won correctness
  guarantees (rebase only once the whole batch is known, occupied-
  destination skips, etc.) that concurrent moves would have to re-prove —
  deferred for the same reason as the walk duplication above.

## Round-15 review findings deliberately not acted on (M35 → FEAT-0069/FEAT-0073)
A 15th `/code-review` pass, run right after centralizing the existence-guard
(`ifExists`/`ifExistsResult`) and never-throws (`serializeResult`) wrappers,
confirmed two more findings. Both were fixed directly (see the commit right
after this entry): `removeNote`/`removeFolder`'s own post-delete `activate()`
call getting the same try/catch-with-fallback moveFolder/renameActive already
had, and `addNote`/`addFolder` no longer reporting a successful disk create as
a failure when a best-effort follow-up step throws. Two others were left as-is:

- `folderStillExists` (main.ts), used by `ifExists` in `promptNewFolder` and
  implicitly relied on by `onCreateNoteIn`, reads `currentFolders` — which the
  background poll only ever refreshes via an explicit folder mutation
  (`addFolder`/`removeFolder`/`moveFolder`'s `onFoldersChanged` calls), never
  on its own cadence the way `currentNotes` is kept live by the relist sweep.
  So an *externally* deleted **empty** folder can stay listed indefinitely
  (not just for the length of one open dialog), and recreating a folder by
  that name auto-vivifies it right back. Left alone: unlike the note-level
  resurrection bugs this session fixed, the "resurrected" thing here is an
  empty directory — the folder had nothing in it when it was deleted, so
  there is no content to lose, only a directory reappearing that a user
  external to Brulion removed. Properly closing this would mean the
  background poll re-walking folders every tick the way it already does
  notes, a real expansion of the poll's own scope, not a call-site fix —
  disproportionate to a cosmetic-only gap on a weekend-scale project.
- `moveFolder`/`renameActive`'s two-step recovery (primary `activate()`, then
  a `pickActiveNote` fallback) can still leave `activeName` stale if *both*
  calls fail — the existing "last resort exhausted" catch already accepts
  this as a documented residual risk rather than chasing a third fallback.
  `removeNote`/`removeFolder`'s fix above brings them to the same single-
  fallback risk profile, not a strictly safer one — deliberately consistent
  with, not better than, the standard the rest of the controller already
  accepts. Closing this fully would need the buffer itself to go non-dirty
  (or blank) when every recovery attempt fails, changing what the user sees
  rather than just how errors propagate — a bigger, more user-visible change
  than this loop's scope.

**Round-16 follow-up:** the 16th pass caught that this entry's own fix was
incomplete on both counts. `removeNote`/`removeFolder` still used bare
`serialize` (not `serializeResult`) with only their tail `activate()` call
protected — `deleteNote`/`deleteFolder`/`listNotes`/`flushAndWait` themselves
could still reject, and both `main.ts` call sites discarded the promise with
a bare `void`, so a failure there was a silent unhandled rejection with zero
user feedback (unlike every sibling mutation). Fixed by giving them the same
`AddNoteResult`/`serializeResult` treatment as `addNote`/`addFolder`, and
updating `onDelete`/`onDeleteFolder` in `main.ts` to alert on `{ok:false}`.
Separately, the "last resort exhausted" branches (now in four places:
`removeNote`, `removeFolder`, `moveFolder`, `renameActive`) never called
`onListChanged` even though `notes` was already accurate — fixed by adding
that call to each. This does *not* change the accepted `activeName`-staleness
risk above (that's still a real, documented residual risk); it only stops
the sidebar's file listing from silently going stale on top of it.

**Round-17 follow-up:** the 17th pass found the round-16 fix for
`removeNote`/`removeFolder` was itself still incomplete — `serializeResult`
wrapped the whole function, but only the tail `activate()` call had its own
local try/catch; the post-delete `listNotes`/`listFolders`/`onFoldersChanged`
calls in between had none, so a transient failure there fell through to
`serializeResult`'s generic catch and reported an already-successful delete
as failed (the exact class of bug `addNote`/`addFolder`'s post-create steps
were already protected against). Fixed by wrapping each method's whole
post-delete sequence in its own try/catch, mirroring `addNote`'s shape.

**Round-18 follow-up:** an exhaustive symmetry check across all six mutating
methods (addNote, addFolder, removeNote, removeFolder, moveFolder,
renameActive) found two more real gaps:
- `removeNote`/`removeFolder` never re-checked `conflict` after their own
  `flushAndWait()`, unlike `moveFolder`/`renameActive` — a save already in
  flight from an earlier autosave tick that resolves to a stale-write
  conflict during that flush would previously fall straight through to the
  delete, permanently destroying the externally-edited content the conflict
  modal was about to let the user review. Fixed by adding the same
  post-flush `conflict` check (scoped to when the note being deleted is, or
  contains, the active note — the only case a flush can raise a conflict at
  all).
- `moveFolder`'s and `renameActive`'s own post-mutation `notes = await
  listNotes(dir)` calls were themselves unprotected — the exact same gap
  round 17 fixed for `removeNote`/`removeFolder`, just not yet applied to
  these two. A transient relist failure right after every file had already
  moved/renamed on disk fell through to the outer catch and reported the
  whole operation as failed. Fixed by wrapping each method's whole
  post-mutation sequence (relist, link maintenance, activate, notify) in its
  own try/catch, matching the shape used everywhere else.

This is the fourth consecutive round to find the same class of gap in one
more of these six methods or one more step within them — a real pattern,
not noise, and each fix has been mechanical once found. If a future round
finds yet another instance of this exact shape, that's a signal the fix
belongs at a more structural level (e.g. a shared helper that every method's
post-mutation block routes through) rather than another one-off local
try/catch.

**Round-19 follow-up:** it found exactly that fifth instance, predicted
above — `moveFolder`'s own leftover-folder cleanup (the `candidateSubfolders`
loop, and the trailing `createFolder(toPath)`/`deleteFolder(fromPath)`) sat
between the note-move loop and the round-18-protected post-move block,
itself unprotected. Since the active note's own `moveNote` call can have
already succeeded by the time this later cleanup step throws, a failure
there fell to the outer catch *without ever reconciling `activeName`* —
`newActiveName` was set but `activate()` never ran, leaving `activeName`
dangling at the vanished pre-move path exactly like every earlier round's
fix was meant to prevent. Rather than adding a sixth one-off try/catch,
this was fixed by restructuring `moveFolder`: the note-move loop, link
rebase, and folder cleanup now run inside their own inner try, catching into
a `mutationError` variable instead of propagating — so the post-move
reconciliation block (relist, link maintenance, notify, activate/fallback)
*always* runs afterward regardless of whether that inner block fully
succeeded, and only then is the overall `{ok:true}`/`{ok:false}` decided.
`renameActive` was checked for the same gap and doesn't have it — its single
`moveNote` call has nothing risky between it and the protected block.

This did NOT turn out to need the generic "shared post-mutation helper"
flagged as the fallback plan above — the actual fix was narrower (reconcile
unconditionally after a method's own try, not a cross-cutting wrapper).
Kept the escalation note for future rounds: a *sixth* instance of this
pattern, in a method that structural fix doesn't already cover, would be the
real signal to build that shared helper.

## Structural fix: `reconcileAfterMutation` ends the per-method whack-a-mole (M35)
Six review rounds (14–19) each found one more hand-rolled copy of the same
post-mutation block missing a different piece. The user called it: 20 rounds
of one-off patches is the wrong loop — the invariant belongs in one place.
The whole post-mutation contract now lives in a single helper in
`note-controller.ts`, `reconcileAfterMutation`: refresh `notes` → run
independent best-effort follow-up steps (link maintenance, the pre-open
flush) → refresh the folder listing when the folder set changed → re-point
the editor at the target, falling back to `pickActiveNote` **only when the
active path itself vanished** (the autosave-resurrection hazard), announcing
the accurate listing if even that fails. It never throws, and by definition
nothing inside it can be reported as the mutation failing.

Five methods route through it (`addNote`, `removeNote`, `removeFolder`,
`moveFolder`, `renameActive`); `addFolder` deliberately does not — it never
touches the note list (its AC-1 asserts `onListChanged` does NOT fire on
folder creation), so its single follow-up keeps its own dedicated
notification. Two small behavior changes fell out of the unification, both
improvements: (1) a *transient* failure loading the fallback note now
recovers via the helper's single retry instead of leaving the editor on the
stale buffer; (2) `renameActive`'s inbound-link pass now runs before
`activate` (matching `moveFolder`'s existing order) — the two passes touch
disjoint files, so the order was never load-bearing.

The review loop is closed with this refactor. Any future mutation method
MUST route its post-mutation work through `reconcileAfterMutation` rather
than hand-rolling the block — that's the whole point.

## Sidebar tree keyboard nav uses a roving tabindex, the standard ARIA `tree` model (M36 → FEAT-0075)

**What:** the sidebar tree is a keyboard-navigable `tree` widget with exactly
one row in the tab order (`tabindex="0"`) at a time; every other row is
`tabindex="-1"`. Arrow keys move focus *within* the tree and carry the tab stop
with them. One Tab enters the tree at the current row, the next Tab leaves it.
The initial/after-re-render tab stop is the active note's row, or the first row
when none is active.

**Why:** the alternative — one Tab stop per row — turns a large vault into
hundreds of sequential tab stops, exactly what the ARIA pattern exists to avoid.
Roving tabindex is the conventional, screen-reader-friendly, scalable choice.

**Consequence (UI/project):** Tab reaches the tree as a single stop and moving
between rows is arrows-only; a keyboard user never tabs through the whole vault.
Confirmed in the M36 review.

## Left/Right are two-step, and tree movement never wraps (M36 → FEAT-0075)

**What:** Right on a collapsed folder expands it; Right on an already-expanded
folder descends to its first child; Right on a note does nothing. Left on an
expanded folder collapses it; Left on a collapsed folder / a note moves to the
parent header (no-op at root). Down on the last visible row and Up on the first
are no-ops — no wrap-around.

**Why:** this is the ARIA `tree` convention one-to-one (file explorers, IDE
trees), so it matches the muscle memory of anyone who navigates trees. Wrapping
disorients in a tree — it's easy to lose your place — so movement deliberately
stops at the ends.

**Consequence (UI/project):** expand/descend and collapse/ascend each take a
predictable two presses; the caret can't silently jump from bottom to top.
Confirmed in the M36 review.

## Enter and Space both activate the focused tree row (M36 → FEAT-0075)

**What:** with focus on a tree row, both Enter and Space activate it — open the
note or toggle the folder — the same result a click gives. Space is captured
within the tree, so it does not scroll the page while a row is focused.

**Why:** Space-to-activate is the ARIA `tree` convention and is comfortable; the
only cost is intercepting Space's default page-scroll while focus is in the tree,
which is an acceptable, contained trade-off.

**Consequence (UI/project):** either key opens/toggles the focused row; page
scroll via Space is suppressed only while the tree holds focus. Confirmed in the
M36 review.

## M36 stays movement-only — file actions remain on the context menu (M36 → FEAT-0075)

**What:** M36 adds no file operation. Create/delete/move/rename stay on the M35
context menu (Shift+F10, FEAT-0071); M36 only moves focus and toggles folder
expansion (which is not a note-file write, and reuses FEAT-0043's persisted
toggle).

**Why:** keeping movement and actions separate kept the milestone small and
testable, and M35 already gives a full keyboard path to actions.

**Consequence (UI/project):** the boundary held — but the M36 review surfaced one
real comfort gap (a direct rename shortcut from the focused row), pulled forward
as M37 below.

## M36 review: F2-to-rename plus the deferred comfort items become M37 (M36 review → M37)

**What:** the M36 milestone review produced one course-correction and a home for
the deferred items. **F2** on a focused row (note *or* folder) triggers the same
rename flow the context menu runs — chosen because F2 is the file-explorer/IDE
convention for rename. It ships as a new milestone **M37 — Sidebar tree
follow-ups**, which also absorbs the items M36 deliberately deferred: **typeahead**
(type a letter to jump), **multi-select**, and **touch gestures for movement**.

**Why:** F2 is a genuine daily-use gap (reaching rename only via Shift+F10 is a
detour). The deferred items get a scheduled home rather than being closed
silently, per the user's call in the review.

**Consequence (UI/project):** M37 is scheduled (see `ROADMAP.md`). Note: the
agent recommended keeping multi-select and touch out of scope (they sit uneasily
with the lean ethos and this niche, and touch already reaches actions via M35
long-press); the user chose to include them, so what "touch gestures for
*movement*" should do — scrolling already works — is an open question to settle
at M37 spec time.

## M37 shape: multi-select must earn its keep, and touch-movement is descoped (M37)

**What:** two shape calls made autonomously at the start of the M37 build, to be
reviewed live at the end. **(1) Multi-select is not built as dead UI** — it ships
*with* its consumers, batch **Delete** and batch **Move**, routed through the
existing `removeNote`/`moveNote`/`moveFolder` primitives (each keeping the same
existence/conflict guards a single-row action has). Selection with no action
behind it would be scaffolding for a feature that doesn't exist. **(2) A
standalone "touch gesture for movement" is descoped** — on touch, movement
already works end to end (scroll moves, tap opens, tapping a folder header
expands/collapses), so a bespoke movement gesture would only duplicate the
scroll. The real touch win is *multi-select by touch* (tap-to-toggle), which P3
delivers.

**Why:** the lean ethos — "the simplest thing that holds" — forbids building a
selection model with no operation to consume it, and forbids a gesture that
duplicates a built-in one. Folding the genuine touch value into multi-select
gives the user what they asked for (touch reaching the new capability) without a
redundant movement gesture.

**Consequence (UI/project):** M37 is three phases — P1 (F2 rename), P2
(typeahead), P3 (multi-select + batch delete/move). No P4 is authored. The
descope is the headline item for the M37 review; if the user does want a distinct
touch-movement gesture, it comes back with a concrete behavior to implement
rather than an open "make touch move somehow."

## Tree typeahead: what drives it, when the buffer resets, and one deferred edge (M37 → FEAT-0077)

**What:** three non-obvious calls settled over a long code-review loop (6 rounds),
recorded so they aren't re-litigated. **(1) A typeahead key is a single character
with no Ctrl/Alt/Cmd** (Shift still counts). Modifier flags can't classify
"text vs shortcut" the same way on every OS — Alt+letter is a Windows/Linux menu
accelerator but composes real text on macOS (Option), and AltGr is reported as
Ctrl+Alt, indistinguishable from a genuine Ctrl+Alt shortcut. Every non-conservative
rule swallows a real shortcut on some platform, so all chords are rejected. The
cost — characters that *need* a modifier to type (accented/composed letters) don't
drive typeahead — is accepted; plain letters work everywhere and such notes stay
reachable via the arrows or the Ctrl+K switcher. **(2) The search buffer resets on
exactly two things: the 500ms coalescing timeout, and a completed tree action**
(`action.type !== "none"`). It deliberately does **not** try to classify which
*other* keys end a session — earlier attempts (a modifier blocklist, then a
tree-key allowlist, then a focusout listener) each kept springing a new leak
(NumLock/Dead keys wiping it; a background repaint's `focusout` wiping it). Not
enumerating is the fix. **(3) Same-letter mash cycles** (a repeat of the single
buffered char keeps it one char instead of growing to "aa"), case-insensitively.

**Why:** the recurring review findings were all the same shape — an incomplete
key classification. The lean, correct answer is to classify only the two things
that have crisp definitions (a printable char; a resolved tree action) and ignore
everything else, letting the timeout be the backstop.

**Consequence (UI/project):** typeahead is robust across odd keys, IME/dead keys,
lock keys, and background repaints, at the cost of no accented-character typeahead.
**One known, deferred edge:** a background list re-render restores keyboard focus
to the *active note's* row (pre-existing M36/FEAT-0075 behavior), so a repaint that
lands mid-typeahead-cycle can desync the surviving buffer from where focus went
(the cycle restarts from the first match). It is niche and self-correcting; the
proper fix — restoring focus to the previously-focused row by path — is an M36
change with its own edge cases (hidden/deleted rows) and is left for a focused
follow-up if it bites in real use. Raised at the M37 review.

## M37 milestone review outcomes (live, with the user)

**What:** the M37 review (via `elicit`, against the deployed app) confirmed most
decisions and produced two corrections. Confirmed as-is: the touch-movement
descope (no separate gesture; the touch value is multi-select by tap); the
multi-select interaction model (Ctrl/Cmd+Space, Shift+arrows, Ctrl/Cmd+click,
tap-toggles-when-active); and the two deliberate calls — the editor does not
follow an open note that was itself batch-moved, and batch delete is Delete /
Cmd+Backspace (bare Backspace inert). **Corrections applied:** (1) typeahead now
matches **diacritic-insensitively** (FEAT-0077/AC-10) — folding accents to the
base letter so a Polish user reaches `łódka` by typing `l`, since the accented
character itself needs an AltGr/Option chord typeahead rejects; (2) the review
process itself — the review-heavy P2 (6 rounds) and P3 (8 rounds) showed the
`/code-review --fix` loop spins when point-fixes chase the same class of finding,
so the **`/review-until-clean` skill** now encodes two rules (restructure after 2
rounds of the same class; every test added for a fix must fail against the
pre-fix behavior), and this repo's `CLAUDE.md` routes the review step through that
skill.

**Why:** the milestone review is the batched, live course-correction point; these
are the changes the user asked for on the spot, plus the process lesson from
watching the loops converge only once the root cause (not the effects) was fixed.

**Consequence (UI/project):** M37 is complete and reviewed. Typeahead is
accent-insensitive (Polish names reachable by plain ASCII). Future review loops in
this repo follow the two `/review-until-clean` rules. No milestones are scheduled
beyond M37.

## Cross-device permalinks: name-keyed workspaces, an emergent feature (M38)

**What:** scheduled M38 — make a note permalink resolve on any of the user's own
devices. The two building blocks already shipped: M19 gave note-URLs
(`#/path/to/note`) and M33 gave `?ws=`. The gap is only the `?ws` key: today it's
a **random per-machine** opaque id (`crypto.randomUUID().slice(0,8)` in
`vaults.ts`), so the same synced folder gets a different `?ws` on each device and
the full URL is device-local. M38 keys the workspace by a **stable name** stored
in the vault's `.brulion.json` (the M16 settings file, which already travels with
the folder), and resolves `?ws=<name>` against granted vaults, falling back to the
legacy opaque id for links already in the wild.

**Why:** the moat is the files, and this is a *pure* moat play — no `.md` bytes
touched, the note stays addressed by its plain path, and the workspace name rides
in the config file the user already syncs, so it needs no second thing kept in
step. Chosen over a rename-stable per-note id in frontmatter (which would survive
moves) because that pollutes the file and collides with the M23 "opaque
frontmatter, no interpretation" stance — a path-permalink is the file-faithful
choice even though a rename breaks it. The name (not the OS folder name) is the
key so `~/Sync/notes` on one box and `D:\backup` on another can both be
`workspace: "notes"`.

**Honest scope (recorded so we don't over-promise):** this is cross-*own-devices*,
**not** "works on any foreign machine" — the FSA cannot silently locate "the
folder called notes" on a machine that never granted it, so a permalink there
degrades to "pick your notes folder, then I open the note." And it's a **personal
bookmark, not a sharing link**: the URL does nothing for someone who lacks your
folder. Correction to the framing that sparked this: name-keyed local-vault URIs
are **not** unprecedented — Obsidian's `obsidian://open?vault=…&file=…` does the
same thing. Our distinctive part is the delivery: a plain clickable **https** URL,
no app install and no custom protocol handler.

**Consequence (UI/project):** a `workspace` field appears in `.brulion.json`
(set/edited via M16 settings; defaults to the folder name, user-owned). `?ws=`
resolution changes from id-only to name-first-then-id. A new **collision rule** is
needed because names aren't unique the way minted ids were (0 granted matches →
pick-a-folder onboarding; 1 → attach; >1 → disambiguate). No change to note bytes
or the path-addressed note routing.

## M38 implementation outcomes (FEAT-0079 P1 + FEAT-0080 P2)

**What:** the two phases as built. **P1** keys `?ws` on a vault's *effective name*
(the `workspace` field in `.brulion.json`, else the folder name), cached on the
vault record and refreshed on attach so startup resolution needs no disk read or
permission. Resolution is name-first, opaque-id fallback (legacy links keep
working). **P2** adds a "Workspace name" field to the settings modal that writes
`.brulion.json` and *live*-updates the window's `?ws` + the cached name.

**Two design calls settled during the build (both after review loops):**

1. **`?ws` is always the effective name — one model, no special cases.** The stamp
   is applied when the window commits to a vault (so a reload *during* an attach
   resumes it) and refreshed after settings load; a legacy opaque-id `?ws` upgrades
   to the name. An earlier attempt to *preserve* legacy-id links (not rewrite them)
   spawned a cascade of timing/collision edge cases across review rounds; collapsing
   to "always the name" reduced them to a single documented limitation. Rollback
   gates on the prior vault: a failed *switch* re-asserts the previous `?ws`, a
   failed *cold start* clears it so a reload self-heals to the most-recent vault.
2. **An explicit but unmatched `?ws` never opens a *different* vault.** It falls to
   the welcome/pick flow with the URL intact (so the note resolves once the right
   folder is granted). Only an *absent* `?ws` falls back to the most-recent vault.

**Why:** the moat — the note is still path-addressed, only `.brulion.json` and the
browser-private vault cache/URL are written, no `.md` bytes touched. The "always
name" model is the file-faithful, portable identity; the unmatched-`?ws` rule stops
a permalink from silently opening (or create-on-miss writing) a note in the wrong
folder.

**Consequence (UI/project):** a note URL is now portable across the user's own
devices; a Workspace name field lets folders named differently per device share one
link. Limits (documented, deliberate): cross-*own-devices* not foreign-machine;
path-permalink breaks on rename; name collisions resolve to the most-recently-used
vault.

**Open for the milestone review (a product call, not a bug):** the P2 field lets a
user set a workspace name equal to *another* local vault's effective name, silently
creating a collision that the most-recent tiebreak resolves in favour of the just-
edited vault — hijacking the other vault's `?ws` permalink. We ship the documented
tiebreak with no warning; whether the field should **warn on collision** is left for
the live review to decide.

## Extension spike: opaque-origin iframe + nonce-bound capability RPC (FEAT-0081)

**What:** the Phase 0 extension spike uses a dedicated `MessageChannel` between
Brulion and a script running in an iframe with `sandbox="allow-scripts"` and
**without** `allow-same-origin`. The host authenticates the transferred port with
a one-time nonce, validates a small versioned envelope, dispatches only explicitly
registered asynchronous capabilities, and accepts only recursive JSON-like values
on the wire. Requests have bounded timeouts; disposing a peer removes listeners,
rejects pending calls, and makes later messages fail closed. The spike is
JavaScript-only; it does not add script discovery, storage, UI, or production
command/editor integration.

**Why:** local extension code is untrusted application code even when it lives next
to the user's notes. A same-origin iframe or direct `eval` would give it a path to
Brulion's DOM, CodeMirror state, and File System Access handles. An opaque-origin
sandbox keeps the script out of the app's origin, while the capability registry
makes the exposed surface auditable and keeps file-fidelity-sensitive state in the
host. JSON-like validation is intentional: structured clone can transfer
`FileSystemHandle` objects, so relying on structured clone alone would accidentally
widen the boundary.

**Browser/deployment consequences:** an opaque-origin frame cannot be addressed with
a fixed `targetOrigin`, so the bootstrap uses `postMessage("*", …)` only for the
expected iframe window and relies on source identity plus the nonce; all subsequent
traffic uses the dedicated port. Production must serve the frame under a restrictive
CSP (`frame-src` for the chosen `blob:`/static source, `connect-src 'none'`, no
`allow-same-origin`, and no popup/top-navigation capabilities). GitHub Pages is
static and cannot set custom response headers from this repository, so a production
rollout needs a meta CSP plus a deliberate hosting/header plan; the spike does not
claim that a meta policy alone is equivalent to a response header. File System
Access handles remain host-only and are never passed through the extension API.

**Consequence (project):** FEAT-0081 leaves a runnable protocol test and browser
harness plus a written threat model. The next phase may build script storage and
UI on this boundary, but must keep the host-side source/nonce checks, capability
allow-list, value validation, timeout, and disposal invariants. Native folder
picker/permission prompts remain a manual check in the later live-app review.

## FileSystemObserver is a future acceleration path, not the source of truth (M40)

**What:** schedule a future M40 to re-evaluate M4's polling choice by using the
browser's `FileSystemObserver` when it is available, primarily to replace
expensive full recursive scans with targeted invalidation for large vaults and
`.brulion/scripts/` trees. Each Brulion window continues to open and observe the
same vault independently; no window-to-window IPC is required for correctness.

**Why:** M4 deliberately chose polling because it is portable across browsers
that support the File System Access API. The user's vault is still the API and
remains authoritative: observer events are notifications that a view may be
stale, not a reliable replacement for reading the current directory, manifest,
source, or mtime. `FileSystemObserver` is experimental and not uniformly
available, so a polling/rescan fallback is required rather than making the
app's correctness depend on it.

**Consequence (UI/project):** M39 keeps its simple scan-and-reload behavior.
M40 may add observer-backed targeted refreshes, periodic fallback scans, and
recovery for missed events, but must retain mtime conflict guards, explicit
reload/enable semantics, and filesystem reads before acting. Independent windows
converge through the shared vault on their own refresh cycles; optional
cross-window notifications may only accelerate that convergence.

## Full extension workbench and Authoring Kit are M41 (after the M39 runtime slice)

**What:** schedule M41 as the next product milestone for the remaining
extension-authoring work: a separate Brulion window with a multi-file script
tree/editor, safe extension creation and lifecycle operations, the versioned
Extension Authoring Kit, and the Lucide-backed command icon API. M40 remains a
separate future performance milestone for filesystem observation.

**Why:** M39 proves that a trusted host can run an explicitly enabled script, but
its inline single-file editor and manual folder creation are not an authoring
experience. Users and LLM agents need a complete, discoverable contract and a
safe way to create the ordinary files that make up an extension. Keeping that
work in M41 avoids turning the runtime spike into a half-built IDE.

**Consequence (UI/project):** M41 opens the workbench in a separate window while
each window independently reads the shared vault; filesystem state, mtime guards,
and explicit enablement remain the consistency boundaries. The Authoring Kit is
one versioned source that includes the template, declarations, examples,
`AGENTS.md`, an LLM skill, and a prompt, so those surfaces cannot silently drift
apart. Arbitrary SVG, TypeScript execution, package installation, and FSO-backed
watching remain explicitly out of scope for M41.
