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
