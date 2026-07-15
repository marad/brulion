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
  (AC-9). It is gated on a folder being open *and* the conflict modal being closed
  (that modal must remain the only forward path).

**Consequences.**
- *UI:* before — type a name into a sidebar box to create; after — `Ctrl/Cmd+K` (or
  the sidebar button) opens a palette: fuzzy list, ↑/↓ + Enter to open, type a new
  name + Enter to create, Esc/backdrop to dismiss. Typing the name of an existing
  note now *opens* it (no duplicate, no error) rather than refusing it.
- *Tests:* the create path in several e2e specs (note-crud, links, wikilinks,
  subfolders, link-interaction) moved from `#new-note-input` to the switcher; the
  old "refuses a duplicate" test became "typing an existing name opens it".
- *Moat:* untouched — the switcher only reads the note list and triggers the
  existing create on explicit user action; nothing else is read or written.
- *Deferred:* full-text/body search, a general command palette (rename/delete), and
  recency ordering are out of scope (see `milestones/M12.md`).

### FEAT-0032 follow-up: caret also kept out of a line's *leading* hidden marker (M11/M12 review)

The first cut only snapped a caret that was **strictly inside** a hidden run,
treating the line-start edge (offset 0) as valid. But a line-leading run (`# `,
`> `, `* `) is zero-width, so offset 0 renders on top of the first visible glyph —
and Vim's `0`/`^`/`I` land there. Reported from real use: on `# test`, `Esc` then
`I` then typing produced `foo# test` instead of `# foo test` (the insert went
*before* the hidden marker). Fix: `leadingHiddenEnd` — any caret within a line's
leading hidden prefix (including its start edge, chaining adjacent runs like nested
`> > `) snaps **forward** to the first visible character. So line-start motions and
insert-at-line-start now land after the marker. Consequence: under Vim you can no
longer park the caret before a line-leading marker (it's invisible anyway; Backspace
from the first visible char still removes the marker). AC-2/AC-5 of FEAT-0032 were
rewritten accordingly.

### FEAT-0034 — Renaming a note moves the file natively, and does not touch other notes' links (M14)

A note's identity is its folder-relative path, and M14 makes that path renamable.
Two decisions shaped the file-fidelity core underneath the rename.

**A rename uses the native `FileSystemFileHandle.move()`, not read-write-delete.**
Chromium ships an atomic move primitive; we use it so a rename relocates the file's
bytes as-is — no read, no rewrite, no copy, and no window where the content lives in
neither location. The alternative (read the old file, write a new one, delete the
old) churns the bytes, risks a half-completed move losing content, and would touch
the file's mtime/encoding in ways other tools notice. `move()` is Chromium-only,
which is consistent with our existing FSA-only stance (the whole app already requires
`showDirectoryPicker`). `moveNote` guards the destination first (never clobber an
existing note — the moat) and mirrors `createNote`'s handling of a folder segment
blocked by a like-named file (reports the path as taken rather than throwing).

**M14-review addendum (commit-on-blur + a copy-then-delete fallback).** The live
review surfaced two things on **Android Chrome** (which exposes `showDirectoryPicker`
but refuses `move()` with "state changed since it was read from disk"): the inline
rename editor cancelled on blur — wrong on touch, where tapping away is "done" — and
native `move()` simply did not work. So: (1) **blur now commits** the rename (like
Finder / VS Code; Esc still cancels), and a thrown rename error is shown inline rather
than leaving the editor silently stuck (a mobile PWA has no console). (2) `moveNote`
keeps native `move()` as the preferred path but **falls back to copy-then-delete**
(read fresh → write the new path → delete the old) when `move()` is absent or refused.
The fallback writes before deleting, so the moat still holds: a mid-way failure leaves
a duplicate at worst, never content lost. This is the user's own "read before write"
intuition, and it makes the rename work across non-Chromium-desktop engines.

**A rename does NOT rewrite link references in other notes.** Moving `a.md` to
`b.md` updates only the moved file's own identity and the in-app active/list state.
Links *to* the renamed note that live in other files are left exactly as the user
(or another tool) wrote them — they become dangling, which the existing
missing-target handling (FEAT-0025/0027) already covers gracefully. Rewriting
references across the vault would be a multi-file *byte* mutation of files the user
did not ask us to touch, which the moat forbids us from doing silently; it is also
expensive (read every note, parse, rebase relative paths) and easy to get subtly
wrong. The folder is the API; a rename moves one file.

**Consequences.**
- *Storage:* new `moveNote(dir, from, to)` in `note.ts` returning
  `moved | exists | missing`; reuses the private `getExisting`/`splitPath`/
  `resolveParent` helpers, so no path logic is duplicated.
- *Controller:* new `renameActive(name)` flushes pending edits, moves the file, then
  re-points the editor at the new path (new active note, refreshed list, announced),
  all inside the serialize queue so a concurrent poll can't misread the move as an
  external delete-plus-create.
- *Moat:* bytes preserved exactly on the moved file; no other file is read or
  written by a rename.
- *Known limitations (to confirm at the M14 review):* renaming a brand-new note that
  was never saved to disk (a never-materialized lazy seed) reports failure rather
  than materializing it at the new name — type something first; and a case-only
  rename on a case-insensitive filesystem is refused by the no-clobber guard.
- *Deferred:* the header identity display and click-to-rename UI (FEAT-0035);
  rewriting inbound links; rename undo.

## Note URLs: hash route mirroring the open note (M19 / FEAT-0036)
Every open note gets an address so it can be bookmarked, shared, and walked with
the browser's own Back/Forward — turning visit history into prev/next navigation
with no custom history stack. Decisions:

- **Hash routing, not History `pushState` paths.** Brulion is a static GitHub
  Pages site with no server to rewrite deep paths — a real path URL (`/a/b`) would
  404 on reload. A location hash (`#/a/b`) is the only zero-config option and is
  consistent with the no-backend moat. (Rejected: real-path pushState; needs SPA
  fallback/rewrites we deliberately don't have.)
- **URL shape: `#/segment/segment`, `.md` stripped, segments individually
  percent-encoded, `/` preserved as separator.** Mirrors the user-facing
  `displayName` (no `.md`) while staying path-addressed (FEAT-0023). A new pure
  module `note-route.ts` owns the total round-trip codec (`pathToHash` /
  `hashToPath`); unit-tested directly with no DOM. A malformed/empty hash, or one
  with an empty segment, decodes to `null` (no bogus path).
- **The open note is the single source of truth; the URL mirrors it.** The
  controller already announces every active-note change via `onListChanged`; that
  one site reflects the active note into the hash. A genuine navigation pushes a
  history entry (`location.hash =`); the initial load settles the URL with
  `history.replaceState` so landing on a note leaves exactly one entry (no phantom
  "previous" for Back to step onto). Setting the hash to its current value adds no
  entry.
- **`hashchange` drives `switchTo`; no feedback loop.** Back/Forward/typed-URL fire
  `hashchange`; the handler switches to the named note via the existing `switchTo`.
  Mirroring the active note into the hash fires `hashchange` too, but the handler
  no-ops when the target already equals the open note — so reflecting never reads
  back as a fresh navigation.
- **A well-formed hash naming a missing note raises a non-blocking banner (M19
  review correction).** The first cut left such a hash *inert* (stay on the current
  note, no feedback). The review rejected that: at runtime it left the address bar
  naming a note that wasn't open, with no signal to the user. Instead a dismissible
  banner names the missing note and offers to **create** it (reusing the existing
  `addNote` create path + name validation); creating switches to the new note,
  dismissing re-syncs the URL back to the open note so it never lies. The open note
  is unchanged while the banner stands, and the hash stays on the missing target
  (what the banner offers to create). A *malformed* hash is still ignored silently.
  This is the one deliberate file write a route can cause — only on the explicit
  banner action, never automatically — so the moat still holds (a note appears only
  on a user gesture). (Supersedes the original "inert" decision; consistent with the
  dead-link `confirm("Create it?")` flow, but non-blocking rather than modal so a
  stale bookmark on load doesn't ambush the user with a dialog at startup.)
- **On load the hash beats the persisted last-active note.** Once the folder is
  granted, an initial hash naming an existing note opens it; with no hash / a
  malformed hash / a hash naming an absent note, the normal persisted-active (else
  seed) flow stands. Honored only after a folder is opened — before that the
  first-run screen shows.

**Consequences.**
- *New module:* `note-route.ts` — pure `pathToHash`/`hashToPath` codec.
- *Wiring (`main.ts`):* `onListChanged` mirrors active→hash; a `hashchange`
  listener drives `switchTo` (guarded against the loop and against missing notes);
  the open flow consumes the initial hash once, settling the URL with
  `replaceState`.
- *Moat:* unchanged — the hash is navigation state only; no file is read or written
  differently.
- *Foundation for M21:* the browser now records visit history for free, which M21
  reuses for most-recently-visited recency.
- *Deferred:* in-app Back/Forward buttons (M9/PWA), recency ranking (M21),
  auto-create from a URL (the banner creates only on its explicit action), and
  deep-linking to a position inside a note.
- *Known cosmetic edge (accepted):* pressing Back/Forward **while the
  standing-conflict modal is open** changes the hash but the switch is correctly
  blocked, so the address bar momentarily names a note that isn't open until the
  conflict is resolved. Very rare (Back exactly during an open conflict); no data
  loss; restoring the hash would mean fighting the browser's own history, not worth
  it at this scale. (The other earlier edge — Back onto an externally-deleted note —
  is now resolved by the missing-note banner above.)

## Wikilink autocomplete: reuse the switcher's scoring and the editor's note set (M20 / FEAT-0037)
Typing `[[` opens a `@codemirror/autocomplete` list of existing notes — the
name-first ergonomic linking M8/FEAT-0027 promised, now suggested instead of typed
from memory. The source (`src/link-complete.ts`) is a peer to the slash source
(both registered via `markdownLanguage.data.of({ autocomplete })`; each returns
null off its own trigger, so they coexist). Decisions:

- **One source of truth, twice.** Candidates come from the editor's existing
  `linkContext` facet (`notePaths`) — the *same* set that drives valid-vs-broken
  link rendering — not a separately threaded list; and ranking calls the existing
  `note-search.ts` (`searchNotes`), the *same* fuzzy scoring the Ctrl+K switcher
  uses, so the order is consistent between the two surfaces. No second list, no
  second scoring. (Rejected: thread the note list in through `EditorOptions` — a
  second copy that could drift from the render facet; a bespoke fuzzy match — a
  second ranking that would disagree with the switcher.)
- **`filter: false`, no `validFor` → re-rank per keystroke.** Returning the result
  with `filter: false` keeps the `note-search` order authoritative (CodeMirror does
  not re-sort), and omitting `validFor` makes CM re-invoke the source on each
  keystroke, so the ranking refreshes against the growing query rather than CM
  narrowing the first snapshot with its own (different) fuzzy filter. Cheap at
  tens-to-hundreds of notes. (Rejected: CM's default filtering — a *third* ranking,
  inconsistent with the switcher.)
- **Insert the shortest *unambiguous* form (Obsidian-style), not always the full
  path.** *(Reversed during the M20 review — see below.)* Accepting replaces the
  partial target with the note's **bare name** (`.md` stripped, no folder) when that
  basename is **unique** in the vault — so a nested `projects/diablo.md` inserts as
  `[[diablo]]` — and only the **full path** (`[[projects/diablo]]`) when the basename
  is **ambiguous** (a bare name would resolve to the first sorted match, FEAT-0027).
  The bare form reads cleaner and survives the note moving folders; the full form is
  the collision fallback that keeps the link resolving to the chosen note. One shared
  helper, `shortestLinkText` (in the new pure `wikilink.ts`), is the single
  definition of this form, used by both the autocomplete insert and the right-click
  toggle so they never disagree. Accepting also closes `]]` (reusing an existing `]]`
  right after the caret rather than doubling it) and leaves the caret after the link.
  The completion *label* still shows the full display path so same-named notes are
  distinguishable in the list. (Originally we inserted the full path always, for
  unambiguous resolution; the user asked for Obsidian's name-default — shortest
  unambiguous gives both the clean name *and* correct resolution.)
- **A right-click toggle switches a link between its full-path and name-only forms.**
  *(Added in the M20 review.)* Right-clicking a rendered wikilink that resolves to a
  nested note with a unique basename adds one context-menu item — "Use full path" or
  "Use name only" — above the formatting items; `computeWikilinkToggle` rewrites only
  the link's target (any `|alias` is preserved) so it still resolves to the same
  note. The item is hidden when the switch would be a no-op or unsafe: a root-level
  note (both forms equal), an ambiguous basename (the name-only form would retarget),
  or a dangling link (no note to canonicalize against). It reads the same
  `linkContext` facet for the note set, so "which notes exist" stays one source of
  truth across rendering, autocomplete, and this toggle.
- **Existing notes only; no create-on-miss.** Unlike the switcher, autocomplete only
  *suggests* — it never creates. Typing a name that matches nothing is left alone
  (a dangling wikilink, which FEAT-0027's missing-target handling already renders
  broken and offers to create on follow). A note whose name contains `[`/`]` is
  **never offered**: those break the `[[…]]` delimiters, so the renderer (and any
  other tool) can't represent it as a wikilink — suggesting it would insert a dead
  link. (Such names are valid on disk, just not wikilink-addressable; `|` can't
  occur — `normalizeNoteName` rejects it.)
- **Moat: editor-only.** The completion reads the facet and edits the buffer's link
  text; nothing is read from or written to the folder. The bytes the user owns are
  the plain `[[path]]` they'd have typed by hand.

## Search ranking & recency: two-tier scoring + an own MRU list (M21 / FEAT-0038, FEAT-0039)

Two reported daily-use failures in the quick switcher, fixed as two phases on
`note-search.ts`. Pure ranking logic — no file behavior changes, moat untouched.

- **Ranking is two disjoint tiers (FEAT-0038).** The old greedy subsequence scorer
  charged the first matched char a penalty equal to its absolute distance from the
  string start — so a note matched deep in a long path (`Allegro/Journal/Week/…`)
  sank purely for its folder depth — and grabbed the first occurrence of each query
  char left-to-right, so a clean contiguous run was never recognized *as* contiguous
  when an earlier scattered alignment existed. `fuzzyScore` now: (1) if the query is
  a **literal contiguous substring**, scores it in a band (`SUBSTRING_BASE`) strictly
  above any gapped match, ranked by where the run begins (segment-start > mid-token);
  (2) otherwise runs a **best-alignment DP** (max over all alignments, not greedy);
  (3) penalizes only **interior** gaps (chars skipped *between* matches), never
  leading distance — so **folder depth costs nothing**. Tier 2 is clamped strictly
  below the substring band so a substring match always wins, for any input length.
  `searchNotes`'s contract (return shape, empty-query name order, path tiebreak,
  `create`) is unchanged, so both callers — the Ctrl+K switcher and the wikilink
  autocomplete (FEAT-0037) — keep working untouched and share the one scorer.

- **Recency keeps its own MRU list — the roadmap's "reuse M19's visit history" was
  not literally possible (FEAT-0039).** M19 (FEAT-0036) leans entirely on the
  browser's Back/Forward stack, which JavaScript cannot read back. So recency
  maintains its **own** most-recently-visited list of note paths (`touchRecency`,
  pure: front + dedupe + cap 50), persisted in IndexedDB (`brulion:recency`) beside
  the other `brulion:` UI state, and touched on every genuine active-note change —
  the same signal M19 already mirrors into the URL. *Consequence:* one more IDB key;
  the list is loaded before the first folder open (`openNote` awaits `recencyReady`)
  so the first recorded visit can't race past the persisted list.

- **Recency is a sort key, never a score term.** `searchNotes` gained an optional
  `recency` arg used as the tiebreak **between** score and path:
  `score desc → recency → path asc`. *Consequence in the UI:* an **empty** switcher
  query (all scores 0) collapses to most-recently-visited first, then name order —
  so the note you were just in sits at the top, a couple of arrow-downs from its
  neighbours. A **typed** query is ordered by match quality; recency only reorders
  notes with the **equal** score, so a freshly-touched poor match can never jump a
  better one. Never-visited paths share a finite rank sentinel (`recency.length`,
  not `Infinity`) so two of them compare equal and fall through to name order
  without producing a `NaN` comparator. Recency applies to the quick switcher only;
  the wikilink autocomplete keeps its pure match-quality order (it calls
  `searchNotes` 2-arg, so `recency` defaults to empty).

### M21 review fixes (live app)

- **The open note is excluded from the switcher entirely (variant B).** The
  original FEAT-0039 had the most-recently-visited note — which is the note you
  *currently have open* — sitting at the top of an empty switcher, a dead first row
  ("you are here"). The review chose to **omit the open note from the results for
  any query**: you can't switch to where you already are (`switchTo` is a no-op on
  the active note). *Consequence:* on an empty query the first row is the
  **previously**-visited note, so Enter performs an Alt-Tab-style toggle back to
  where you came from. The exclusion lives in the quick switcher (a `getActiveNote`
  dep + a one-line filter), **not** in `searchNotes` — so the wikilink autocomplete,
  which may legitimately list the open note, is unaffected. (FEAT-0039 AC-8.)
- Confirmed unchanged in the review: the two-tier ranking with no name-segment bonus
  (substring-wins is enough); recency staying a pure tiebreaker on typed queries
  (match quality rules); and the own MRU list (IndexedDB, cap 50, local per-browser)
  in place of M19's unreadable browser history.

## Rename rewrites inbound links: a pure core, reusing the resolvers, gated by a confirm (M25 / FEAT-0040)

M14 (FEAT-0034) deliberately moved only the renamed file and left links to it in
*other* notes dangling — the moat forbids silently mutating files the user didn't
ask us to touch. M25 closes that loop: on a rename, links that pointed at the old
path are rewritten to the new one. This is **not** a moat violation — it's plain
markdown the user owns, changed only on an explicit, user-initiated rename, and
only after the user confirms which files change. Decisions:

- **A pure rewrite core (`link-rewrite.ts`), separate from the I/O.** All
  byte-mutating logic lives in one DOM/FSA-free module
  (`relativeLink` + `rewriteLinksForRename`), unit-tested directly — the part where
  a bug corrupts the user's files. The controller only does the I/O orchestration
  (read each note → rewrite → guarded write). Tests were written cold (a
  fresh-context subagent against the contract) before the bodies, per the
  tests-first rule.
- **Detection reuses the existing resolvers — one source of truth.** "Does this
  link point at the renamed note" is answered by `resolveNotePath` (markdown links,
  relative to the linking note's folder) and `resolveWikilink` (wikilinks), the
  *same* functions the renderer uses. The bare-vs-full wikilink choice reuses
  `shortestLinkText` (FEAT-0037). No second notion of where a link goes. Markdown
  link *spans* are found with the `@lezer/markdown` grammar (so images and
  reference links are correctly excluded); wikilink spans via the shared
  `findWikilinks` (extracted from `findWikilinkAt` so the `[[…]]` offset math lives
  in one place).
- **Three link forms, each rebased correctly.** Markdown links → the POSIX relative
  path from the linking note's folder to the new path (`relativeLink`, round-trip
  with `resolveNotePath`; a destination needing it is wrapped in CommonMark's `<…>`
  form). Slashed wikilinks (`[[sub/note]]`) → the new full path. Bare wikilinks
  (`[[note]]`) → kept **bare** when the basename is still unique post-rename (so a
  pure folder move needs *no* rewrite — the basename follows the note across
  folders), promoted to a full path only when the move would otherwise make the
  bare name resolve to a *different* note.
- **The user confirms which files change; every write is guarded.** The multi-file
  write is never silent: the controller asks an injected `confirmLinkUpdate` gate
  (wired in `main.ts` as a `window.confirm` naming the affected notes) and writes
  only on confirmation. A rename of a note nobody links to writes nothing extra and
  shows no dialog. Each inbound write goes through `saveNote`'s stale-write guard
  with the mtime read moments earlier, so a note edited from outside between the
  scan and the write is **skipped, never clobbered** — a rename touching N files
  can't lose an edit in any. The pass runs inside the controller's serialize queue
  (after the move + active-note follow), and is **best-effort**: a failure in it
  (a rejected confirm, an I/O error part-way) leaves the links as-is rather than
  reporting the already-succeeded rename as failed.
- **Consequence / accepted cost.** The pass reads every *other* note on a rename
  (sequential, no index) — the right altitude at quick-capture scale (the folder
  tree stays the single source of truth, nothing to bookkeep), with an O(N) I/O
  ceiling if a vault grows to hundreds of notes. The renamed note's own bytes are
  untouched (it's excluded from its own scan). Out of scope: reference-style
  markdown links (`[ref]: path`, which the app doesn't render), the moved note's
  *own* outbound relative links (a folder move can break those — a separate
  concern), a global rename-any-note surface, and undo of a multi-file rename.

### M25 review fixes (live app)

Two changes from the milestone review, walked through on the deployed app.

- **The confirmation gate is removed — rename rewrites inbound links silently and
  unconditionally (supersedes the FEAT-0040 "confirms which files change" bullet
  above).** The original cut put a `window.confirm` (listing the affected notes)
  in front of the multi-file write. The user rejected it: if you *decline*, you're
  left with the dangling links M25 exists to fix — so the gate is a footgun, not a
  guardrail. A rename's links should just follow it, like a refactor-rename in an
  IDE; the user *asking* for the rename is the consent. The moat concern (don't
  touch files silently) is about *background* mutation, not the natural consequence
  of an explicit user action. So: no prompt, no toast — fully silent, like the
  rename itself. *What stays:* the `saveNote` stale-write guard (a file changed
  from outside between scan and write is skipped, never clobbered — the only
  data-loss risk that actually matters), and the conflict-skip is left silent too
  (a milliseconds-wide race; the result is one broken link, a single manual fix).
  *Consequence:* `confirmLinkUpdate` is gone from the controller options and
  `main.ts`; `renameActive`'s inbound pass writes every changed note directly, and
  is best-effort (a failure in it never reports the already-succeeded rename as
  failed). FEAT-0040 AC-9/AC-10/AC-11 were rewritten accordingly.
- **A folder-crossing rename now rebases the moved note's *own* outbound links
  (M25 Phase 2 / FEAT-0041).** The first cut fixed only *inbound* links; the review
  found the mirror gap unacceptable ("tak nie może zostać"): moving a note to
  another folder left its own relative markdown links (resolved relative to the old
  folder) pointing at the wrong place. New pure `rebaseOutboundLinks(text, old,
  new)` recomputes each in-tree relative markdown destination from the new folder
  (reusing `resolveNotePath`/`relativeLink`, round-trip-correct), leaving wikilinks
  (basename/root-relative — unaffected by a move), external, and non-note links
  alone; a same-folder rename changes nothing (returns `null`). A **self-link**
  follows the note (its target maps old→new), so it never dangles. The controller
  runs it after the move and before re-pointing the editor, skipping the file read
  entirely on a same-folder rename, and writes through the same stale-write guard.
  *Out of scope, deliberately:* the O(N) full-vault read on every rename — the
  right altitude at quick-capture scale (folder tree is the single source of truth,
  nothing to index), but acknowledged as a broader future topic (it interacts with
  the poller and anything else that scans the vault) to revisit if a vault grows
  large; reference-style markdown links (the app renders only inline links).

## Frontmatter rendered collapsed, opaque, bytes untouched (M23 / FEAT-0042)

A leading `---…---` YAML frontmatter block rendered as raw fences at the top of a
note — ugly, and a broken "markup is never visible" promise for the one construct
people paste at the top of a note. M23 hides it behind a discreet, expandable
chip. The decisions, all bending to the file-fidelity moat:

- **Structural detection, not the parser.** Lezer markdown ships no frontmatter
  node, and a leading `---` is otherwise ambiguous (thematic break / setext
  underline). We detect it the way Obsidian/Jekyll/pandoc do: **line 1 is exactly
  `---`**, closed by a later line that is exactly `---` or `...`; the block is
  bytes `[0, closingLine.to]`. A pure `frontmatterRange(state)` returns it (or
  `null`). *Why:* fully under our control, no extra parser extension, and the
  leading-fence-plus-close convention disambiguates from a body `---`.
- **Only a *closed* block renders.** A leading `---` with no closing delimiter yet
  (being typed) stays raw — same rule as an unclosed fence and a bare `#` heading,
  so the marker never vanishes mid-typing.
- **Opaque — no field interpretation, no reserialize.** We never parse the YAML
  or read `title`/`tags`/`aliases` (deferred; `title` collides with the
  filename-as-identity model and M14). Decoration only; the bytes are never
  rewritten — a parse-and-reserialize would churn quoting/order/indentation and
  other tools would notice. *Consequence:* saving a note round-trips the exact
  original frontmatter, verbatim.
- **Collapsed by default; explicit click to expand.** Collapsed = a `block`-level
  `Decoration.replace` over the whole block, drawing a clickable `▸ metadata`
  chip (atomic, so the caret skips it). Expanded = no replace; the raw lines get a
  subtle box (line decorations) plus a `▾ metadata` block header to collapse
  again — the user edits the raw text directly. *Why a click, not a
  selection-reveal like links (FEAT-0026):* the collapsed block is atomic, so the
  caret can't get inside to trigger a reveal — the chip *is* the only way in.
- **A `StateField`, not the viewport `ViewPlugin`.** Block-level / line-break-
  replacing decorations are layout-changing, which CodeMirror only accepts from a
  field — the same reason FEAT-0016's block constructs live in
  `blockRenderingField`. Frontmatter is at most one block at the doc head, so a
  whole-doc scan on doc-change is cheap.
- **Collapse state resets to collapsed on every programmatic note load.** Because
  `setEditorText` replaces the doc *within the same `EditorState`*, the field's
  collapsed flag would otherwise leak across note switches (open A expanded →
  switch to B → B opens expanded). The field watches the programmatic-load
  annotation and resets to collapsed. *Consequence:* the load annotation, until
  now private to `editor.ts` (`External`), moves to a tiny shared module
  (`editor-load.ts`) so both the editor and the frontmatter field can read it
  without an import cycle.
- **New module `frontmatter.ts`,** wired into the editor's extension list beside
  `markdownRendering`, rather than bloating `markdown-render.ts`. The detector is
  pure and unit-tested; the field/widgets are the only stateful glue.
- **The markdown renderers skip the frontmatter range.** `renderPlugin` and
  `blockRenderingField` don't know about frontmatter, so in the *expanded* state
  they'd hide/style markdown-active characters inside the raw YAML (a `# comment`
  line → heading, `**x**` → bold) — breaking the "raw, opaque" promise. Both build
  sites now drop any decoration whose span intersects the detected frontmatter
  range (a one-way `markdown-render → frontmatter` dependency). Correct in both
  states: collapsed, the region is block-replaced anyway; expanded, the raw text
  shows unstyled.

## Folder tree opens collapsed by default; persist the *expanded* set, not the collapsed one (M13 / FEAT-0043)

In a large vault the note tree opening fully expanded is a wall of every note at
every depth. M13 Phase 1 flips the default: the tree opens **collapsed** (only the
top level), the user expands what they need, and that choice persists. The
decisions:

- **Persist the expanded set, invert the polarity.** FEAT-0024 stored the folders
  the user *collapsed* (absent = expanded). With collapsed as the new default that
  polarity can't work — a single "collapsed" set has no way to also record an
  *expanded* folder, and an absent folder must now read as collapsed. So the
  persisted set is inverted to hold the folders the user **expanded** (absent =
  collapsed). The render rule becomes
  `isCollapsed = !expanded.has(path) && !isAncestorOfActive`; the toggle handler
  inverts (`collapsed ? delete : add`). *Consequence:* `renderNoteList`'s 5th
  param and the session helpers are renamed collapsed→expanded; the
  `onToggleFolder(path, collapsed)` callback contract is deliberately left as-is
  (it still reports the new *collapsed* state), so the inversion is localized to
  the one caller in `main.ts`.
- **New storage key, old one abandoned — no migration.** Stored under a new
  `brulion:expanded-folders` key; the old `brulion:collapsed-folders` is simply
  left behind. Its meaning is inverted, so migrating it would be wrong; on first
  load the new key is empty ⇒ the tree opens fully collapsed, which is exactly the
  intended new default. *Consequence:* an existing user's folder-expansion state
  resets once, to "all collapsed" — trivial, transient UI state, and the feature
  changes that default anyway.
- **The "reveal the active note's ancestors" rule is preserved and still not
  persisted.** An ancestor of the open note is always rendered expanded
  (overriding the collapsed default and absence from the set) so the open note is
  never hidden — but force-showing it does *not* add it to the expanded set, so it
  collapses again once the active note moves elsewhere (unless the user expanded
  it explicitly).
- **Moat-neutral.** Expand/collapse is browser-local UI state (idb-keyval);
  opening, expanding, or collapsing a folder writes nothing to the user's folder.

## Sidebar width: drag the border, a clamped pixel basis via a CSS var (M13 / FEAT-0044)

The sidebar was a fixed `14rem`. M13 Phase 2 lets the user drag the
sidebar/editor border to set its width. The decisions:

- **A flex-child handle + a CSS-var basis.** The width is applied as a
  `--sidebar-width` custom property the sidebar's `flex: 0 0 var(--sidebar-width,
  14rem)` reads, so it composes with the existing `min-width: 0` ellipsis and the
  collapse rule untouched; the former `14rem` survives as the var's fallback
  default. The grab handle is a thin flex child sitting on the border between
  `#sidebar` and `#editor`. *Consequence:* no layout restructure — one declaration
  changes, plus a 5px handle element.
- **Floored at 144px, no fixed maximum (revised in the M13 review).** A pure
  `clampSidebarWidth` floors the width at 144px so a drag (or a corrupt non-finite
  stored value) can't shrink the sidebar to an unusable sliver. There is **no upper
  clamp**: instead the editor carries `min-width: 20rem` and the sidebar is
  flex-shrinkable (`flex: 0 1 …`), so widening the sidebar stops once the editor
  would drop below its minimum — a *viewport-relative* cap that adapts to the
  window rather than an arbitrary pixel limit. The stored width may exceed what
  currently fits; it renders capped and renders wider again on a wider screen.
  *Why the change:* the original fixed `560px` max was an arbitrary proxy for
  "leave the editor room"; expressing that intent as the editor's own min-width is
  more honest and scales across screens (decided in the M13 milestone review).
- **End the drag on `lostpointercapture`, not `pointerup`.** The drag uses
  `setPointerCapture` (keeps tracking if the pointer leaves the thin handle) and
  ends on `lostpointercapture`, which fires on both a normal release *and* an
  interruption (pointercancel, an OS gesture). *Why:* a single end path guarantees
  cleanup (text-selection suppression, listener removal) always runs, and it
  persists the *last applied* width — exactly what the user sees. A `pointerup`-only
  handler would leak state on an interrupted drag.
- **Persisted browser-local, awaited before first paint.** The clamped width is
  saved under `brulion:sidebar-width` (idb-keyval, like the other UI prefs) and
  the load is awaited in `openNote` alongside the expanded-folders/recency loads,
  so a saved width applies before the sidebar first paints (no flash of the
  default). *Consequence:* moat-neutral — resizing writes nothing to the user's
  folder.
- **Handle present only while the sidebar is visible.** It is `hidden` before a
  folder opens (revealed by `showWorkspace`) and removed by CSS while the sidebar
  is collapsed — there is nothing to resize in those states.
- **Out of scope:** keyboard resizing and double-click-reset (a later
  keyboard/mobile concern), a settings-modal width control (M16), and
  touch/mobile behavior (M17).

## Copy fidelity: repair the selection's two boundaries, don't re-serialize (M22 / FEAT-0045)

CodeMirror's default copy hands the clipboard `sliceDoc(from, to)` — the raw
source *inside* the selection. Because our markdown markup is rendered as atomic,
hidden runs, a selection's boundaries snap *past* a leading `# `/`> `/`* ` or
*inside* a `**…**`/`` `…` `` span, so the slice drops those markers: copying a
heading's visible text pasted as plain text, copying half a bold word pasted
malformed. The decisions:

- **Boundary repair, not whole-selection re-serialization.** The interior of the
  slice is verbatim source and already carries every marker of every construct it
  fully contains — only the *first and last* selected positions can sit past an
  opening marker or before a closing one. So a new pure serializer
  (`copy-markdown.ts → serializeCopy`) emits `prefix + sliceDoc(from,to) + suffix`,
  where the prefix/suffix are exactly the markers the two boundaries dropped:
  the first line's leading block marker, and the inline delimiters synthesized
  around the fragment. *Why:* "copy the selection, not the snagged construct" —
  add only what makes the selection valid markdown, never a character more.
  *Consequence:* a full-construct selection is byte-identical to the source (no
  doubled markers); the on-disk file is never touched (clipboard-only).
- **Delimiters read verbatim; nesting ordered.** The synthesized markers are read
  from the document (`__`/`_`/multi-backtick survive, not normalized to `**`/`*`),
  and nested spans repair outermost-first on open / innermost-first on close, so a
  fragment inside `**_x_**` round-trips as `***`-wrapped, not crossed. *Why:*
  fidelity to what the user actually wrote.
- **Links & wikilinks deliberately out of scope.** markdown-render already reveals
  a link's raw `[text](url)` / `[[target]]` whenever the selection touches it
  (FEAT-0026), so the raw markup is *already inside the slice* at copy time. No
  repair needed; repairing them would double markers. *Consequence:* the repair
  scope is headings, blockquotes, unordered lists, bold/italic/inline-code only.
- **The line-marker repair is confirmed against the syntax tree, not just text**
  (review fix). A text-only regex would misfire on a `# comment`/`- item` line
  *inside a fenced code block* (literal `CodeText`, which the renderer hides
  nothing on) and on a `- tag` line *inside expanded frontmatter* (the markdown
  parser, blind to frontmatter, parses it as a list). The prefix is added only
  when the syntax tree confirms the line is a real heading/blockquote/list
  container *and* the line is outside the frontmatter range — mirroring exactly
  what the renderer hides. *Why:* the repair must never invent a marker the user
  can't see.
- **Cut repairs identically, then deletes only the selected range.** The
  synthesized markers live *outside* the selection, in the file, so cutting half a
  bold word puts `**half**` on the clipboard while the document keeps `**bold**`
  valid. Empty selections fall through to CodeMirror's default (linewise copy);
  empty ranges in a multi-range selection are skipped, matching the built-in.
- **Out of scope:** a `text/html` rich-text clipboard flavor (the backlog's coupled
  "rich-text copy + paste" item), paste (unchanged), and fenced-code-block fences
  (only *inline* code is repaired).

## Vim yank routed through the same serializer (M22 P2 / FEAT-0046)

The M22 review caught that P1 (FEAT-0045) fixed only the system-clipboard copy/cut
path — a DOM event. Vim's `y` is a *separate* mechanism: `@replit/codemirror-vim`
stores the raw `getSelection()` in its own register and never fires a DOM `copy`
event, so visual-mode yank still dropped the hidden boundary markup (a heading's
`# `, a bold span's `**`). The decisions:

- **Override the package's `yank` operator, reuse the one serializer.** Via the
  public `Vim.defineOperator("yank", …)` the yanked text becomes
  `serializeCopy(view.state, view.state.selection.ranges)` — the *same* FEAT-0045
  boundary-repair serializer the clipboard uses. *Why:* one source of truth for
  "what does copying this selection mean", whether it's Ctrl/Cmd+C or `y`. The
  package documents that the live editor selection matches the operator's input
  range, so serializing it yanks neither more nor less than the stock operator.
- **Mirror the stock operator exactly otherwise.** Same register routing (unnamed,
  `0`, named, the `+` clipboard register), same post-yank cursor (a local
  `cursorMin` replicating the package's). Only the stored *text* changes.
  *Consequence:* `"+y` now puts the repaired markdown on the system clipboard too,
  consistent with the clipboard path; a linewise `yy` is byte-identical (its `from`
  is the line start, so no marker is doubled).
- **Only `yank`, installed once.** Delete/change (`d`/`c`/`x`) and the `:yank`
  ex-command are untouched; paste is unchanged. The override installs globally and
  idempotently at editor module load, and is only ever reached while Vim mode is on.
- **Out of scope:** delete/change register fidelity (raw text as before) and any
  paste-time transformation — deferred unless a real need shows up.

## Settings live in a per-vault file, `.brulion.json` (M16 P1 / FEAT-0047)

M16 needs a home for preferences (font, text size, editor width, Vim). The decisions
for the engine under the modal (the modal UI itself is P2):

- **Stored in `.brulion.json` at the open folder's root — the single source of
  truth, no idb cache.** Settings are plain, readable, pretty-printed JSON in the
  user's own folder, so they travel with the vault across machines/OSes. *Why:*
  consistent with the file-fidelity moat (the prefs are the user's, in the user's
  folder) and with M16's explicit "no idb cache, no defaults-vs-current" framing.
  Read fresh on each folder open; before any folder is open the built-in defaults
  apply. *Consequence:* opening a folder is read-only for settings; only an explicit
  user change (toggle/modal) writes the file.
- **The settings file is invisible to the note layer for free.** `listNotes`
  already collects only `.md` files, so `.brulion.json` never appears in the note
  list and never trips the M4 poller. *Why:* no new exclusion code — relied on (and
  verified by an e2e) the existing filter. *Consequence:* the "ignore this non-note
  file" requirement cost nothing.
- **Vim moves from idb to the settings file (per-vault, was per-browser).** The
  `brulion:vim` idb key and `saveVimMode`/`loadVimMode` are deleted; Vim is now a
  field in `.brulion.json`. *Why:* M16 puts the Vim toggle in the same "single home"
  as the appearance settings, and one storage mechanism is leaner than two.
  *Consequence (flag for the milestone review):* the Vim choice now **travels with
  the vault** rather than staying on the machine, and toggling Vim now **writes
  `.brulion.json`** — so FEAT-0021's old AC-8 ("nothing is written to the folder")
  was reworded to "never writes a *note* file" (the moat guarantee — note `.md`
  bytes are still never touched). This is the one debatable M16 call: a case exists
  for Vim being a personal per-device habit that should stay in idb.
  **Reviewed & confirmed:** the user clicked through the deployed M16 and confirmed
  Vim *should* travel with the vault — kept as built.
- **Applied via three CSS custom properties, headings scale for free.**
  `applySettings` sets `--editor-font-size`, `--editor-measure`, and (when a font is
  chosen) `--font-stack` on `:root`, and toggles Vim via the existing `setVimMode`.
  The editor theme reads the first two with the historical 16px/68ch as `var(...)`
  fallbacks (so the pre-folder look is unchanged). *Why:* headings already use `em`,
  so one base-size knob scales the whole H1/H2/H3 hierarchy with no extra code; an
  empty font removes the inline `--font-stack` so the stylesheet default is the one
  source of truth for the default stack.
- **Width presets:** Narrow→`68ch` (today's default), Wider→`90ch`, Full→`none`.
  **Text size:** clamped to 12–24px. *Why:* a small, legible range; the presets keep
  the centered-measure feel rather than exposing a raw width.
- **Font names are sanitized against CSS injection.** `normalizeSettings` drops font
  entries containing quote/semicolon/brace/backslash/newline. *Why:* the file is
  hand-editable; a malicious or fat-fingered name must not break or inject into the
  `--font-stack` inline style. The P2 picker only ever supplies real installed-font
  names, so this only guards a tampered file.

## Settings modal, entry points, and local-font access (M16 P2 / FEAT-0048)

The visible surface over the P1 engine. Decisions:

- **The modal owns no state.** It reads the current settings to seed its controls
  and reports change patches to the P1 `updateSettings` (apply + persist); after any
  change the host calls `settingsModal.sync()` to re-seed. *Why:* one source of
  truth (`.brulion.json`), no modal-vs-file drift. *Consequence:* there is no
  Save/Cancel — every control applies live, matching the single-source model.
- **Header Vim button removed; gear + `Ctrl/Cmd+,` are the entry points.** The Vim
  toggle now lives inside the modal; `Ctrl/Cmd+;` is unchanged. *Consequence:*
  FEAT-0021's header-button UI is superseded (its spec + e2e were reconciled to the
  modal toggle and the chord; the chord drives the Vim e2e via `.cm-vimMode`).
- **Font: pick one primary family, never free text; generic floor auto-appended.**
  The model supports a longer ordered stack (`font: string[]`), but the v1 UI sets a
  single primary face (P1's `buildFontStack` appends the `sans-serif` floor). *Why:*
  lean — a multi-font reorderable stack builder is deferred until wanted. Selection
  only, because a free-typed name silently fails when the font is absent.
- **Local fonts via `queryLocalFonts`, degrading to a curated preset list.** When the
  API is missing (non-Chromium), denied, or throws, `resolveFontChoices` returns a
  small cross-OS preset list instead of erroring. *Why:* consistent with the
  FSA-only, Chromium-first stance; the control must never break. A family chosen on
  another machine still shows as selected even if not in the resolved list.
- **The stepper steps from the seeded value, not a live read.** `baseSize` is set
  only by `seed()` (on open and on the host's post-change sync), so each ± is
  independent of the other and the modal behaves correctly whether or not the host
  re-seeds synchronously — chosen over reading `getSettings()` live (which couples
  per-press correctness to the host's sync timing).
- **Modal hygiene:** focus is captured on open and restored on close (like the quick
  switcher), and the modal won't stack over the switcher (mutual keyboard guards).

## Code-block syntax highlighting (M15 P1 / FEAT-0049)

- **Languages via `@codemirror/language-data` (lazy `codeLanguages`).** A fenced
  block's info string selects the parser; parsers dynamic-import on first use, so a
  code-free note loads no grammar and the main bundle grows ~5% (the 143-language
  descriptor table only). *Why:* lean at runtime — don't ship parsers to users who
  never open a code block — and the FEAT-0029 service worker caches each loaded
  chunk cache-first, so a language highlights offline after one online encounter.
  *Consequence:* the build emits ~95 small lazy chunks (~460 KB total, all on-demand);
  an unknown/blank info string stays a plain box; the very first offline encounter of
  an uncached language shows plain (graceful, no error).
- **Highlight is scoped by *range* to fenced blocks, not a global
  `syntaxHighlighting`.** *Why (caught in code review):* markdown prose and nested
  code share one highlight-tag namespace — `@lezer/markdown` tags `Escape`, `Comment`,
  and `LinkTitle` with `escape`/`comment`/`string`, exactly the tags code needs — so a
  global highlighter would recolor prose backslash-escapes (`\*`), HTML comments, and
  link titles (a visible AC-4 violation). Instead `collectCodeMarks` runs the tree
  highlighter only over each `FencedCode` range and emits `tok-*` mark decorations,
  colored by a small `.tok-*` CSS palette. *Consequence:* prose is provably never
  touched (a unit test asserts no marks outside code; an e2e asserts no `tok-*` spans
  in a prose note with escapes + comments); the stable `tok-*` class names also set up
  M18 theming. The render plugin rebuilds on a `syntaxTree` change so colors appear
  when a lazily-loaded language finishes parsing.
- **One light palette (GitHub-light-ish).** A dark variant waits for M18's theme.

## Frontmatter highlighted as YAML, reusing the code palette (M15 P2 / FEAT-0050)

The M23-review follow-up: the expanded frontmatter region (FEAT-0042) is painted as
YAML.

- **Same grammar + palette as a fenced `yaml` block.** `frontmatterYamlMarks` parses
  the region's inner text with `@codemirror/lang-yaml`'s parser and emits `tok-*` mark
  decorations colored by M15 P1's `codeTokenTheme`. *Why:* one source of truth for
  token colors — frontmatter and code look identical and pick up a future (M18) theme
  together. *Consequence:* the YAML grammar tags keys, quoted strings, and comments
  (plain scalars/numbers stay plain — the grammar doesn't tag them); this is exactly
  how a ```` ```yaml ```` block renders, so it's consistent, and the spec/Done were
  worded to match reality rather than promising number coloring.
- **Expanded-only, decoration-only, opaque.** Marks are emitted solely in the field's
  expanded branch (collapsed is the chip, nothing to color); nothing is hidden or made
  atomic; no field is interpreted; the bytes are never read-for-rewrite nor modified
  (the FEAT-0042/M23 moat stance). Parsing is synchronous (frontmatter is small) and
  error-tolerant (malformed YAML still renders).

## Mobile UX — responsive drawer & touch formatting (M17 / FEAT-0051, FEAT-0052)

- **Target Chrome; no storage fallback for other browsers.** M17 makes the UI touch-
  and narrow-viewport-friendly. **Reviewed & confirmed:** the user runs Chrome, where
  the File System Access API works (including on the phone), so the touch UI genuinely
  serves phones — consistent with the project's existing FSA-only, Chromium-first
  stance. We deliberately do **not** add a non-FSA storage path for browsers that lack
  it (that would dilute the file-fidelity moat); there, the app degrades to the welcome
  screen.
- **P1: the sidebar drawer reuses the collapse state, but starts closed when narrow.**
  Below a `40rem` breakpoint the sidebar is an absolute overlay drawer over a
  full-width editor with a dimmed backdrop; at/above it, the inline column as before —
  the same FEAT-0020 `sidebar-collapsed` state, rendered two ways. *Consequence:* a
  backdrop tap and a note-select close the drawer, both gated on the breakpoint so
  desktop is untouched; the resize handle and wordmark are hidden when narrow.
  **Reviewed & changed:** on a narrow viewport the drawer now **always starts closed**
  and does **not** read or write the persisted collapse pref (that pref stays purely
  desktop) — a deliberate per-device default, because opening over the editor on every
  phone load was annoying. The ☰ control is also **moved to the left edge** on narrow
  (the drawer opens from the left).
- **The ☰ toggle is a plain button — no pressed-state highlight (desktop + narrow).**
  **Reviewed & changed:** the `[aria-pressed="true"]` background was dropped; whether
  the sidebar/drawer is open is already visible from the layout, so the highlight was
  redundant. The `aria-pressed` attribute stays for screen readers.

(continued — M17 P2)

- **P2: a touch selection toolbar, gated to touch/narrow, sharing the menu's actions.**
  A floating toolbar appears over a non-empty selection only when `(pointer: coarse)`
  or the narrow breakpoint matches — so a desktop mouse user keeps right-click +
  `Ctrl` and gets no new always-on UI. Its buttons reuse the extracted `FORMAT_ITEMS`
  (now shared by the context menu and the toolbar — one definition, identical clean
  markdown). *Implementation note:* positioning reads the editor layout, which throws
  if done during a CodeMirror update, so it runs in the measure phase via
  `requestMeasure`; the toolbar also tracks scroll to stay anchored.
  *Flag for review (live touch check):* two behaviors are best confirmed on a real
  device — the toolbar following the selection during a touch scroll, and hiding when
  focus leaves the editor without a CodeMirror focus-change (e.g. tapping a header
  control). Both look correct in code/e2e but the e2e can't fully exercise touch.

(continued — M17 P3, decided in the review)

- **One formatting surface: the selection toolbar, everywhere.** The M17 review found
  that on touch a long-press (how you select) fired the right-click *formatting* menu
  on top of the toolbar — a duplicate popup. Resolution: the toolbar drops its
  touch/narrow gate and becomes the single formatting surface on **desktop and touch**;
  the right-click menu is **reduced to its one position-based item, the wikilink-form
  toggle**, and opens only on a wikilink (plain-text right-click → the browser's native
  menu). *Why:* one consistent affordance, less code, and the duplicate popup is gone
  by construction (the menu no longer carries formatting). *Considered & declined:*
  putting the wikilink toggle on the toolbar — it's position-based, not
  selection-based, so it stays a (slim) right-click menu. *Consequence:* on desktop
  the toolbar now appears on a selection; to avoid mid-drag flicker it shows only once
  a pointer drag **settles** (a drag flag cleared on pointerup/pointercancel/blur).
  FEAT-0009's spec was reconciled (formatting moved to the toolbar; menu is
  wikilink-toggle-only). *Known nit (not P3):* `frontmatter.spec.ts` shows occasional
  load-induced flakiness under the full 8-worker e2e run (a different no-selection test
  each time; passes in isolation) — an e2e-timing fragility, not a product bug.

## M27 — Settings & header polish

(M27 P1, FEAT-0054)

- **Folder switching moved out of the header into the settings modal.** The header's
  plain "Switch folder" button is gone; the settings modal gained a Folder section
  (open folder's name + a "Switch folder…" button). *Why:* folder switching is a rare
  action that spent a permanent header slot; it belongs with the other preferences,
  and the header stays lean (note identity + sidebar toggle + gear). *Consequence:* the
  header carries **no** folder indicator at all; the open folder's name is visible in
  the modal when wanted. The switch reuses the existing open flow unchanged (picker →
  reload notes + `.brulion.json` → persist handle).
- **"Switch folder…" closes the modal on click, not on a successful pick.**
  **Reviewed & kept:** the modal dismisses the moment the button is clicked, then the
  native picker opens; cancelling the picker leaves you in the editor on the old
  folder (not back in the modal). *Why:* the native picker takes the whole screen, so
  holding the modal underneath just to restore it on cancel is artificial — after a
  cancel most people want to get back to writing. Also simpler (the open flow doesn't
  report whether a folder was chosen).
- **Settings entry point is an inline SVG gear, not the `⚙` glyph.** *Why:* the Unicode
  `⚙` renders inconsistently across OS/fonts (colored emoji, boxy shape) — the very
  "doesn't look like a gear" complaint that opened M27. An inline SVG renders
  identically everywhere and inherits the header text color.
- **The Vim toggle shows its `Ctrl/Cmd+;` shortcut as a `<kbd>` chip beside it.** Added
  on the user's request mid-build (folded into FEAT-0054 as AC-8, not done off-spec).
  **Reviewed & kept** as a bare chord chip with no "Shortcut:" label — consistent with
  the app's existing `<kbd>` hints. *Why:* the chord was otherwise undocumented in the
  UI.

(M27 P2, FEAT-0055 — decided in the M27 review)

- **Adopt Lucide as the header icon set; drop hand-authored SVGs.** The P1 review found
  the hand-rolled gear SVG inconsistent beside the ☰ sidebar toggle, and the two header
  buttons rendered at **different heights** (a text glyph sizes by line-height, an SVG
  by its box). Resolution: route header icons through a shared icon set rather than
  hand-authoring one-off SVGs. **Chose Lucide over Font Awesome.** *Why:* Lucide is the
  maintained successor to Feather, so the P1 gear stays visually the same (no shock);
  it tree-shakes to only the icons imported (vs FA's webfont — heavy, FOUT, sizing tied
  to font metrics); and a CDN is off the table since Brulion is an offline-capable PWA
  on Pages (everything self-hosted in the bundle). Moat-neutral — bundled build-time
  dep, output is still a static site, no file behavior touched.
- **Convert the ☰ toggle to the same family and normalize the header buttons.** The ☰
  becomes a Lucide icon (`PanelLeft` — a show/hide-the-side-panel glyph, clearer than a
  generic hamburger for a named note-list sidebar), all header icons are sized
  uniformly, and the header button box is normalized so the controls share one height —
  the actual fix for the height mismatch the user reported.

## M28 — Mermaid diagram rendering

(M28 P1, FEAT-0056)

- **Render `mermaid` fenced blocks visually; never touch the bytes.** A closed
  `FencedCode` node with info string `mermaid` is replaced by a rendered SVG widget
  (`Decoration.replace({ widget, block: true })` from a `StateField`, the same
  block-decoration mechanism as code blocks/frontmatter). The diagram source stays a
  plain fenced code block on disk. *Why:* consistent with the M5/M15/M23/M26
  rendering family and the file-fidelity moat — decorate display only, no
  parse-and-reserialize.
- **Lazy-load Mermaid via a dynamic `import("mermaid")` singleton.** Mermaid is large
  (tens of MB unbundled); it must not sit in the main bundle. A module-level promise
  imports it once, on first need; notes without a Mermaid block never load it, so the
  editor stays instant. *Consequence:* the engine is a separate Vite chunk; the
  runtime-caching service worker (FEAT-0029) caches it on first online load, so
  offline use works after the diagram has been seen once. *Considered & declined:*
  bundling Mermaid eagerly (kills the lean fast-load + bloats every page load) and a
  CDN (breaks the offline-PWA / self-hosted stance).
- **Selection-overlap reveals the raw source; otherwise render the diagram.** Reuses
  the established reveal pattern (rebuild on `selectionSet`): cursor/selection inside
  the block → show the fenced source for editing; outside → show the diagram. *Why:*
  one consistent editing affordance across rendered constructs, and no
  reveal-on-every-keystroke churn.
- **Async widget with source-keyed `eq()`.** `toDOM()` returns a placeholder
  synchronously and the diagram renders into it asynchronously (Mermaid's
  `render()` is promise-based). The widget's `eq()` compares the diagram source, so a
  rebuild from an unrelated edit reuses the existing DOM and never re-runs Mermaid for
  an unchanged block. A stale async render (widget destroyed before the promise
  resolves) is dropped.
- **Parse/render errors show in place, not as a crash.** An invalid diagram renders a
  discreet error box (the message) instead of throwing or leaving a broken SVG; the
  user reveals the raw source (selection) to fix it. Mermaid runs at its default
  `securityLevel` (strict, sanitizing) — fine here since the content is the user's own
  local notes.
- **Render-on-display only.** No authoring aid (live-preview pane, snippet menu) — out
  of scope, consistent with the other rendering milestones.

## M30 — Command palette + customizable action bar

(M30 design, decided up front; refined per phase below)

- **Actions are a first-class model: `Action { id, label, icon?, run() }`, with a
  registry built in `main.ts`.** The app already has a handful of invocable
  capabilities scattered as ad-hoc functions (open the switcher, switch folder,
  toggle Vim, toggle the note list, open settings). M30 names them: each becomes an
  `Action` in one registry. *Why:* the palette and the configurable bar both need a
  single, uniform list of "things you can run" with a label and an optional icon;
  without one model they'd each grow their own. *Consequence:* folder-switch
  (FEAT-0054) and the Vim toggle (FEAT-0021/0047) — the M30 "migrate onto the action
  model" bullet — are reframed as registered actions, reachable from the palette and
  pinnable to the bar; their existing entry points (settings modal, `Ctrl/Cmd+;`)
  stay unchanged and now just call the action's `run()`.
- **The command palette is a NEW module sharing the switcher's *pattern*, not the
  switcher itself.** A separate `command-palette.ts` with its own hidden overlay DOM,
  mounted stateless like the quick switcher (a `getActions()` dep + run on select). It
  reuses `fuzzyScore` from `note-search.ts` and mirrors the switcher's keyboard nav /
  focus-restore / backdrop-click. *Why not reuse `quick-switcher.ts`:* the switcher is
  note-specific (create-on-miss, `displayName`, recency ranking, omit-the-active-note)
  — semantics a palette over actions doesn't share. One small focused module per
  surface beats a generic overlay forked with flags. The shared parts that *are* worth
  factoring (the fuzzy scorer) are already a standalone pure function.
- **Palette shortcut: `Ctrl/Cmd+Shift+P`** (the VS Code convention). `Ctrl/Cmd+P` is
  the browser's print/quick-open and `Ctrl/Cmd+K` is taken by the note switcher; the
  Shift variant is unclaimed and familiar. Capture-phase listener (so neither
  CodeMirror nor Vim swallows it), gated on workspace-shown + conflict-hidden + no
  other modal stacked — matching the existing `Ctrl/Cmd+K`/`,`/`;` handlers.
- **The configurable action bar is additive; the settings gear stays a fixed
  anchor.** Pinned actions render as an extra header group of icon+label buttons; the
  always-present chrome (sidebar toggle, settings gear, install) is untouched. The
  gear is deliberately **not** pinnable/removable — it's the entry point to the very
  surface that configures the bar, so letting the user un-pin it would be a footgun.
  *Consequence:* `Settings.actionBar: string[]` (ordered, pinned action ids) is added
  to the M16 model; the default is **empty** (no surprise UI — the palette is the
  discoverable entry, the bar is opt-in); `normalizeSettings` drops unknown/duplicate
  ids so a hand-edited `.brulion.json` can't break the header.

(M30 P2, FEAT-0058 — refines the "action bar" decision above)

- **All registered actions are pinnable; no `pinnable` flag.** The up-front design
  worried about the settings gear being un-pinned and locking the user out. But the
  gear is a **fixed** header button regardless of the bar, so that lockout can't
  happen — which makes the pinnability of the "Open settings" action moot. Rather
  than special-case which actions may be pinned (a flag + two render-time skips), the
  bar offers **every** registered action; pinning one that already has fixed chrome
  (e.g. settings, note-list) just adds a convenience button — the user's call,
  harmless. Simpler and leaner than a capability flag.
- **Default `actionBar` is empty; unknown ids ignored at render, not in normalize.**
  `normalizeSettings` stays registry-agnostic (it can't import the registry without a
  cycle): it only keeps string entries and de-dups. The **bar renderer** resolves each
  id against the live registry and silently skips misses — so a stale/hand-typed id is
  harmless and `settings.ts` never needs to know the action ids. Default empty means
  zero header change for existing vaults (no surprise UI).
- **Reorder via explicit up/down controls, not drag.** The settings Action-bar section
  lists registered actions with a pin checkbox; the pinned ones show in order with
  move-up/down controls. Drag-to-reorder is more code and a second interaction model
  for a weekend-scale tool — deferred until wanted. Pure list manipulation
  (`togglePinned`, `movePinned`) lives as unit-tested pure helpers beside the existing
  UI glue, consistent with `buildNoteTree`.

### M30 review (live, with the user) — corrections

Walking the deployed app, the user changed several M30 calls. Each supersedes the
matching decision above.

- **Palette shortcut: `Ctrl/Cmd+Shift+K`, not `+P`.** Grouping it with the note
  switcher's `Ctrl/Cmd+K` (K = find a note, Shift+K = run a command) puts it under
  the same finger, and — decisively — removes the failure mode of `Ctrl/Cmd+P`: a
  user who forgets Shift would otherwise get the browser's **print dialog**. In the
  Chromium-only target `Ctrl+Shift+K` has no default binding, and our `Ctrl+K`
  handler already excludes Shift, so the two don't collide.
- **Reorder pinned actions by drag-and-drop, not ↑/↓ buttons.** The user found the
  arrow buttons clearly worse than dragging for ordering. Implemented with native
  HTML5 drag-and-drop (no library — stays lean); desktop pointer drag now, touch
  refinement deferred to M17. Reverses the earlier "up/down (lean)" call — dragging
  is the natural gesture for reordering and the arrows were busywork.
- **Action bar: icon-only buttons + tooltip, not icon+label.** The header stays
  compact as the pinned set grows; the label moves to `title` (hover tooltip) and
  `aria-label` (accessible name). Reverses "icon+label buttons".
- **Settings: the Action bar config is its own distinct section, not another row.**
  A separate, visually-set-off section with its own heading and a scrollable list,
  because the action set will grow and shouldn't be crammed into the flat row list
  beside Font/Text size. (A full tabbed settings redesign — Appearance / Action bar /
  … — was considered and deferred as a larger M16 follow-up; variant A now.)
- **Extract a neutral `actions.ts` module.** The pure action helpers
  (`resolvePinned`/`togglePinned` + the new drag reorder) and the `Action` type move
  out of `command-palette.ts` into `actions.ts`, so `settings-modal.ts` and `main.ts`
  depend on the action *model*, not on the palette (the review flagged the modal
  reaching into the palette for list helpers — the dependency arrow pointed the wrong
  way). `renderActionBar` (DOM) moves to `ui.ts` beside the other DOM glue. The
  command palette keeps `rankActions` + the overlay.

## M33 — Multiple vaults / workspaces

(M33 design, decided up front; reviewed live at milestone end)

- **A set of vaults replaces the single `brulion:dir` handle; each vault is
  `{ id, handle, name }` with a short opaque generated `id`.** The id is stable and
  independent of the folder name (names collide and change), so it can key the
  per-window URL param and the IndexedDB set. A pre-M33 user's single handle migrates
  in as the first vault on first load. *Why opaque id, not the folder name in the
  URL:* robust against duplicate/renamed folders; the name is display-only.
- **Per-window identity via `?ws=<id>` in the URL, not per-window IndexedDB state.**
  The window's vault id rides the query string; combined with the existing `#/path`
  note hash (FEAT-0036), the URL fully describes a window's state. On reload the
  window re-attaches to *its* `?ws` vault — fixing the bug where two windows sharing
  one origin-global handle could swap vaults on refresh. Two windows are independent
  by construction, with no new per-window persisted state. *Considered & declined:*
  a per-window IndexedDB record keyed by some window id — browsers give no stable
  per-window/tab id that survives reload, and the URL is the natural carrier (and
  bookmarkable/shareable), exactly as `#/path` already is for the note.
- **Content-tied session state goes per-vault; window-ergonomics state stays global**
  (decided in the M33 live discussion, overriding the initial "all global" lean).
  **Recency** (FEAT-0039) and **expanded folders** (FEAT-0043) are keyed by vault id
  — they describe a vault's content (its notes, its tree), so bleeding them across
  vaults is wrong (mixed note names in the switcher, nonsense tree state). **Sidebar
  width + collapse** stay origin-global — they're "how I like my window", not about
  which folder is open, and per-vault would surprise the user by resizing the sidebar
  on every switch. A pre-M33 user's global recency/expanded values migrate onto the
  first (migrated) vault. The moat is unaffected (all browser-private UI state).
- **UI calls the concept a "workspace"** (decided live; aligns with the backlog
  "Workspaces" name): the switcher and management list say "workspace". "Open folder"
  (the native picker) stays — you open a folder to *add* a workspace — and the code
  keeps the `vault` term internally. So: a workspace *is* a granted folder; "switch
  workspace" jumps between them.
- **Moat: untouched, categorically.** Vault handles + the set live in IndexedDB; no
  note file is read or written by any of this. Switching a vault is just opening a
  different already-granted folder through the existing controller path.

(M33 P2, FEAT-0060 — the switching UX)

- **The workspace chooser reuses the command palette, not a third overlay.** With the
  note switcher (M12) and command palette (M30) already near-identical overlays, a
  third bespoke one would be the moment to extract a shared base — but the cheaper,
  cleaner move is to *open the existing palette with a transient action list* (one
  action per vault, each `run` = switch to it). The palette is literally "a fuzzy list
  of actions you run"; a vault list is exactly that. So `mountCommandPalette` gains an
  `open(override?)` — when given a list it shows that instead of the registry — and
  "Switch workspace…" calls it with the vaults. Zero new overlay, full reuse of fuzzy
  search / keyboard nav / styling. (This is the "extract at the third instance"
  resolution: the third instance turned out to *be* the second one parameterized.)
- **Switching requests permission inline (the click is a gesture);** the open vault is
  excluded from the list (omit-active, like the switcher). Forgetting lives in a
  settings **Workspaces** section (reusing `removeVault`); the **currently-open**
  workspace has no enabled forget control — you can't pull the vault out from under
  the window. Moat untouched: switching/forgetting touch only the vault set + URL.

## M32 — Link section anchors (FEAT-0061)

- **A `#` in an *internal* link target splits note path from section anchor**
  (`note#section`, `sub/note#section`, `#section`, `[[note#section]]`). Split on the
  first `#`; the path part resolves exactly as M8 (`resolveNotePath` /
  `resolveWikilink`), the rest is the anchor. **External** links (`isExternalLink`)
  are left whole — their `#fragment` is a real URL fragment, not a note anchor. *Why
  split in the render layer for internal links:* wikilink resolution + broken-vs-valid
  styling already happens at decoration time, so the anchor is stripped there and
  carried in a `data-anchor` attribute beside `data-href`/`data-note`; the click
  handler passes it through to the follow callbacks. Markdown links split there too
  (guarded by `isExternalLink`) so the click handler treats both uniformly.
- **Heading match by a Unicode-aware slug; first match wins.** `headingSlug` lower-
  cases, drops punctuation, and collapses whitespace to single hyphens, **keeping
  `\p{L}\p{N}`** so Polish/non-English headings slug correctly (ASCII `\w` would drop
  accented letters). Both the anchor and each heading line are slugified and compared.
  Duplicate-heading disambiguation (GitHub's `-1`/`-2`) is out of scope — the first
  matching heading is the target. A missing heading is a silent no-op (the note still
  opens), never an error.
- **Scroll by scanning document lines, not the syntax tree.** `scrollEditorToHeading`
  walks the doc's lines for a heading prefix (`#`–`######` + space) and slugifies the
  text — parse-independent, so it finds a heading below the just-loaded viewport that
  the incremental Lezer parse hasn't reached yet (the same parse-completeness trap the
  unit tests hit). It scrolls the heading to the top (`EditorView.scrollIntoView`,
  `y: "start"`) and places the caret there.
- **Same-note anchor jumps without switching** (`[text](#section)`, `[[#section]]`):
  an empty path part targets the open note — no `switchTo`, just a scroll. A nice
  in-note table-of-contents affordance that falls out of the same code.
- **Moat untouched.** Splitting/resolving/scrolling are read-only; the only write is
  the unchanged M8 create-on-miss when the *note* doesn't exist.

## M31 — Weekly journal navigation (FEAT-0062)

(Scope settled live with the user; deliberately reduced from the ROADMAP sketch.)

- **M31 is scoped to navigation only — the day-log and the week template are
  deferred.** The ROADMAP sketched two parts (templated week-note navigation + a
  quick day-log appending to a per-day section). In the live discussion the user cut
  it back: no week template (so no seeded per-day headings), and therefore no day-log
  (without a defined structure it would be either inconsistent or crude). M31 ships
  just the **"open this week's journal"** action; the day-log returns if/when a
  journal structure is decided.
- **The action computes a path and reuses the existing open-note path — it does not
  create.** It expands `journalPath` against today, normalizes to a note path, and
  hands it to `openNotePath` (FEAT-0025/0057): switch if it exists, else the *existing*
  create-on-miss prompt creates it. No bespoke creation, no template seeding — so a
  fresh journal note is just an empty note, made by the same confirmed flow as any
  other missing-link target.
- **One setting `journalPath` (string, default empty), placeholders fixed.** Expanded
  against the current date: `{year}`(2026)/`{month}`(06)/`{day}`(25) and
  `{mondayOfTheWeek}` (ISO date of the week's Monday; week starts **Monday**, fixed,
  not locale-configurable — the user is European). Expansion is a pure function of
  (template, date) so it's unit-tested with fixed dates, no `Date.now()` in the core.
- **Empty `journalPath` opens settings** rather than no-op'ing — a gentle nudge to
  configure it (the action is always in the registry).
- **One registry action, English label "Open this week's journal" (calendar icon),
  no dedicated chord.** Consistent with the all-English UI; discoverable via the
  palette and pinnable to the action bar (M30) — we don't add bespoke keyboard
  shortcuts lightly.
- **Moat untouched.** Expanding/opening read only; the only writes are the
  `.brulion.json` preference and the user-confirmed create-on-miss note.

## M26 — Table rendering (FEAT-0063)

- **Render a pipe table as an aligned `<table>` block widget; never touch the bytes.**
  Same family/mechanism as Mermaid (FEAT-0056): a whole-doc `StateField` emits a
  `Decoration.replace({ widget, block: true })` over the table block, registered
  alongside `markdownRendering`. Visual only — no parse-and-reserialize, consistent
  with the M23/M28 moat stance.
- **Detect by a line scan, not the syntax tree.** The base `markdown()` grammar
  doesn't parse GFM tables (we deliberately never pulled in the GFM table extension —
  see FEAT-0026, which took only GFM Autolink). So detection is a pure line scan: a
  **separator row** (cells of optional-colon dashes) with a non-blank **header** line
  directly above and contiguous **body** lines below (until a blank line). Outer pipes
  optional (GFM-style). The scan **skips fenced code blocks** (tracks ``` toggles) so a
  `|`/`---|---` inside code isn't mistaken for a table — the same fence-aware line-scan
  discipline as the M32 heading scan. Parse-independent, so it's robust right after a
  note loads.
- **Alignment from the separator; ragged rows padded/truncated.** `:---`/`:--:`/`---:`
  → left/center/right, plain `---` → default. Column count is the separator's; a short
  body row pads with empty cells, a long one truncates (GFM leniency) — never a crash
  or a stray column.
- **Cells show plain text (no inline markdown inside cells) for now.** Re-rendering
  bold/links inside a rendered cell is deferred — out of scope; the user reveals raw to
  see/edit formatting. Editing-in-place (tab between cells) is also out.
- **Reveal raw source on selection overlap.** The active table block shows its raw
  pipe source for editing; moving out re-renders — identical pattern to fenced code
  (FEAT-0016) and Mermaid (FEAT-0056), incl. click-to-place-caret-inside to reveal.

## M29 — Reveal code-fence markers on edit (FEAT-0064)

- **Reveal a closed fenced block's fence lines when the selection overlaps the block;
  hide them otherwise.** Since FEAT-0016 the fence lines were hidden *always* (empty
  styled rows), making the info string uneditable in place. Now `blockSyntaxRanges`
  skips the two fence-hide ranges for a block the selection touches (strict overlap,
  same rule as links/Mermaid), and `blockRenderingField` rebuilds on selection change
  (it previously rebuilt only on document change) — consistent with the post-M2
  reveal-on-selection layers (FEAT-0026 links, FEAT-0056 Mermaid). The whole-doc block
  scan on each selection move is cheap at notepad scale (the inline plugin already
  rebuilds on selection).
- **Keep the code-box styling while revealed.** The reveal un-hides only the fence
  *text*; every line still carries `cm-code-block` (rounded top/bottom), so the block
  still reads as a code box with the fence visible — like a link revealing its markup
  in-context, not dropping out of the rendered look entirely.
- **Falls out for Mermaid for free.** A Mermaid block already shows its raw source when
  the selection is inside (FEAT-0056); now that source also shows its ```` ```mermaid ````
  fence, so the info string is editable there too. The Vim caret guard reads the same
  `blockSyntaxRanges`, so a revealed fence is no longer "hidden" and the caret rests on
  it normally.
- **Editor-only; bytes untouched.** Reveal/hide is purely which decorations are
  emitted — no document change (the moat).

## M18 — Light / dark theme (FEAT-0065)

- **A semantic CSS-variable palette, light values as the default, dark as an override.**
  The app's colors were scattered literal hex across `styles.css` + the editor theme.
  They're migrated to a small set of semantic custom properties (page bg, surfaces,
  text/muted, borders, accent + accent-fg, link, soft-accent fills, code bg, selection,
  shadow). The **light** values equal today's colors (near-duplicate shades collapsed
  to one token), so the light look is unchanged; only the dark set is new.
- **Three modes via a `data-theme` root attribute + `prefers-color-scheme`.** `system`
  (default) sets no attribute and lets a `@media (prefers-color-scheme: dark)` rule
  supply dark on a dark OS; `light`/`dark` set `data-theme` to force a palette. JS only
  sets/clears the attribute — the media query does the OS-following, no JS polling.
  `color-scheme` is set to match so native scrollbars/controls follow.
- **Default `system`.** Modern and respectful of the OS; a dark-OS user gets dark out
  of the box once this ships (the point of the feature). The picker (M16 settings) lets
  anyone pin light/dark. *Reviewable:* if a non-surprising default is preferred, it's a
  one-line change to `"light"`.
- **The editor reads the same vars.** CodeMirror's theme uses `var(--…)` for its
  background/text/selection/code colors, so the editing surface themes with the chrome
  rather than staying a fixed light theme.
- **Editor/UI only; bytes untouched.** Theming is CSS vars + a root attribute + the
  editor theme reading them — no note byte changes (the moat).
- **P2 (FEAT-0066): the code syntax palette is theme-aware, not deferred.** P1 left the
  `tok-*` code colors a fixed GitHub-light set; on dark they were unreadable on the dark
  code box, so the theme felt incomplete (user feedback at the M18 review). The seven
  distinct colors became `--tok-*` palette tokens (light = the original values, a
  GitHub-dark set in the dark blocks); `code-highlight.ts` reads them via `var(--…)`.
  Shared colors keep one token (property/escape = number blue, meta = comment grey), so
  light is byte-identical. No new switching logic — the tokens ride P1's data-theme +
  media-query mechanism. *Consequence:* code blocks now recolor with the theme; a
  follow-up review point is whether the chosen dark syntax hues suit the user's taste
  (one-line-per-token to retune).

## M24 — Scroll/caret preservation on external refresh (FEAT-0067)

- **Minimal-diff reload instead of a wholesale replace.** The M4 poller reloaded the
  open note with `setEditorText` (replace `0..len`), so CodeMirror mapped the caret to
  the document end and the view snapped to the top on every external change. A new pure
  `diffRange(old, next)` computes the single differing span (longest common prefix +
  non-overlapping suffix → one `{from, to, insert}`, `null` when identical), and
  `reloadEditorText` dispatches only that change. *Consequence:* the reader keeps their
  place when another tool/sync touches the file.
- **No diff library; single contiguous hunk.** A hand-written prefix/suffix scan, per
  the lean ethos. One middle-replace is enough to preserve position; a full multi-hunk
  LCS was explicitly out of scope. MergeView (M7 conflict view) still computes its own
  diff — the two aren't shared (its output isn't exposed as CM changes).
- **Caret maps for free; scroll is anchored explicitly.** The reload dispatches only
  `changes` (no selection), so CM maps the caret through them. The top-of-viewport line
  is captured via `posAtCoords` (fallback `view.viewport.from`), mapped through the
  change, and scrolled back with `scrollIntoView(y:"start")`.
- **Guards and other load paths unchanged.** Only the safe-to-replace external-refresh
  call swapped to the minimal reload; `refreshFromDisk`'s conflict handling and the
  initial-load / note-switch path keep `setEditorText`. The `ProgrammaticLoad`
  annotation still rides the reload, so it never trips autosave — no echo-write (moat).

## Motion is token-driven and double-gated; reduced-motion and the load-gate share one lever (M34 → FEAT-0068)
M34 adds the app's first real motion. Rather than scatter `transition` literals, every
animation reads CSS custom properties — `--motion-fast/medium/slow`, `--ease`,
`--ease-out` — defined once on `:root`. Two problems are solved by the *same* mechanism,
the token values themselves:
- **No first-paint flash.** The tokens default to `~0s` and only resolve to real
  durations under `:root.motion-ready`, a class `main.ts` adds after the first paint
  (two chained `requestAnimationFrame`s). So the load sequence (loading → welcome or
  workspace, the async theme apply) never animates — directly protecting the FEAT-0031
  no-flash invariant we fought for, now extended to the theme cross-fade.
- **`prefers-reduced-motion: reduce` forces the tokens back to `~0s`** even when
  `motion-ready`. One media query, and *every* transition/`@starting-style` becomes
  instant — no per-rule reduced-motion handling, no risk of missing one.
Consequence: tuning the whole app's tempo (the point of the live review) is editing three
numbers in one place; turning motion fully off is one lever. The pre-existing loading
spinner keeps its literal `0.7s` spin (it's a progress indicator, not chrome polish) and
is deliberately left outside the token system. (Rejected: a blanket
`* { transition: … }` — bleeds into CodeMirror's own layout and the resize drag;
per-component reduced-motion overrides — N places to forget one.)

## Overlays animate enter *and* leave in pure CSS via `@starting-style` + `allow-discrete` (M34 → FEAT-0068)
Every modal/overlay toggles the `hidden` attribute (`display:none` ⇄ flex), which
historically can't transition. M34 animates them with **`@starting-style`** (the
enter-from state) plus **`transition-behavior: allow-discrete`** on `display` (defer the
`display:none` until the leave transition finishes) — so the command palette, quick
switcher, settings modal, conflict modal and welcome screen fade + rise on open and fade
on close **with zero changes to their show/hide JS** (still just `el.hidden = …`). The
dynamically-created surfaces (context menu, the CodeMirror autocomplete/slash popup) get
the enter animation for free, since `@starting-style` fires whenever an element goes from
`display:none` to shown. This is Chromium-only CSS — fine, because Brulion is Chromium-only
already (the File System Access API). Consequence: the overlay JS stays untouched and
testable as before; the motion is entirely in the stylesheet. (Rejected: JS-driven
enter/leave classes with `setTimeout` removal — choreography in every overlay for what the
platform now does declaratively; animating only enter — the pop on close is the more
jarring half.)

## Desktop sidebar collapse animates `flex-basis`, guarded against the resize drag (M34 → FEAT-0068)
The collapse (FEAT-0020) was `display:none`, which can't tween. M34 animates it by
transitioning the sidebar's `flex-basis` to `0` (plus opacity), so the editor reflows
smoothly as the column closes — and the mobile drawer (FEAT-0051) slides via `translateX`
with the backdrop cross-fading. The catch: the resize drag (FEAT-0044) writes
`--sidebar-width` on every `pointermove`, and a `flex-basis` transition would make the
column lag a frame behind the cursor. Fix: `wireSidebarResize` adds a `resizing` class to
`#sidebar` on `pointerdown` and removes it on drag end; `#sidebar.resizing` sets
`transition: none`. So collapse/expand animate, but a live drag is pixel-instant.
Consequence: a small, tested behavioural addition to the resize wiring (the class toggle);
the collapse rule changes from `display:none` to `flex-basis:0; opacity:0;
pointer-events:none` with `overflow:hidden` clipping the content as it narrows. (Rejected:
keeping `display:none` and skipping the desktop animation — it's the most-used toggle
(Ctrl+\), the one most worth smoothing; transitioning width unconditionally — the drag
lag.)

## The selection toolbar moves to the `hidden` attribute so it animates like the rest (M34 → FEAT-0068)
The touch selection toolbar (FEAT-0052) was the one overlay shown/hidden via inline
`el.style.display`, which an inline style pins and `@starting-style` can't see across
repeated shows. M34 switches it to the `hidden` attribute (CSS `.cm-selection-toolbar[hidden]
{ display:none }`), so it joins the same fade-in path as every other overlay — and
`@starting-style` fires on each show, not just the first mount. Behaviour is otherwise
identical (it's still shown over a non-empty touch selection). Consequence: one small JS
change in `selection-toolbar.ts`, covered by the existing e2e (a `hidden` toggle is still
`toBeVisible`-observable). (Rejected: leaving inline `display` and animating only opacity —
inline `display:none` defeats the transition; the element would still pop.)

## The `?debug` performance overlay stays permanently (post-M34)
A mobile performance regression surfaced during M34's live review (sluggish note
switching) got fixed with an in-memory note cache, a sidebar re-render short-circuit, and
a poll pause — plus a `?debug` query-param overlay for profiling on-device. Confirmed at
the M34 milestone review: the overlay is a keeper, not a one-off diagnostic to delete.
Consequence: it's a permanent dev tool gated behind the query param, not dead code to prune
later.

## `listNotes` walks sibling subfolders concurrently (large-vault perf pass)
Prompted by real use: at ~2018 notes the app "works fine but lacks fluidity," even on
desktop. Benchmarked with a Playwright + OPFS harness seeding a 2018-note/40-folder vault:
`listNotes`'s recursive walk (`note.ts` → `collect`) awaited each subfolder's full listing
one at a time before moving to the next sibling — for 40 folders, 40 sequential recursive
listings. It runs twice over: once on folder open, and again every 2s poll tick
(`refreshFromDisk` → FEAT-0014's external-edit detection) for as long as the tab is
visible, so its cost is paid continuously, not just once.
Fix: fire off sibling subdirectory recursion concurrently (`Promise.all`) instead of
awaiting each before the next — `listNotes` already sorts the flattened result, so the
arrival order into the accumulator never mattered. No behavior or timing-contract change:
same inputs, same output, same poll cadence — purely how fast the existing walk completes.
Measured on the benchmark vault: the poll tick's `listNotes` cost dropped from ~150–230ms to
~60–95ms (roughly a 60–70% cut); the initial folder-open listing from ~228ms to ~85ms.
`renderNoteList`'s DOM rebuild was checked too and is not a bottleneck (~25ms for 2018 rows) —
left alone; virtualizing it would be solving a problem the numbers don't show.
Consequence: `note.ts`'s `collect` is the only touched function; `note-controller.ts` gained
permanent `track("open: listNotes", …)` / `track("poll: listNotes", …)` timing (visible only
under `?debug`) so this cost stays observable for future large-vault work.
Left on the table, deliberately not pursued without a product call: cutting the poll's full
relist frequency (e.g. every Nth tick instead of every 2s, keeping a cheap per-tick stat on
just the active note for conflict detection) would cut the remaining background cost further
— plausibly getting close to eliminating it — but it changes FEAT-0014's external-add/remove
detection latency from ~2s to considerably more, which two dozen existing tests currently
assert as immediate. That's a UX trade-off, not an implementation detail, so it wasn't made
silently; flagged for the user to decide whether it's worth the latency it gives up.

## Poll cadence split: full relist throttled to 15s, active-note mtime stays at 2s
The trade-off flagged above — user directed it. `note-controller.ts`'s `probeDisk` now only
re-walks the whole tree (`listNotes`, the expensive part) when `FULL_RELIST_MS` (15s) has
elapsed since the last one; every 2s tick still cheaply `statNote`s just the active file, so
the never-silently-clobber guarantee (the actual data-loss risk FEAT-0014 exists to prevent)
is untouched — only the *notice-an-external-add/remove* latency moves from ~2s to up to 15s.
`lastFullListAt` starts at `-Infinity` and is reset to it on every `open()`, so a freshly
attached vault's first poll always verifies for real before the throttle engages — this is
also why all ~25 existing checkDisk/refreshFromDisk tests (each calling it once, right after
open()) needed zero changes: the case they exercise is exactly the always-relist first tick.
A dedicated test (`note-controller.test.ts`) covers the throttled second tick with
`vi.useFakeTimers()`. Considered instead: a tick-counter (every Nth call) — rejected in favor
of wall-clock time, since it doesn't couple to `POLL_MS` and reads directly as "at most every
15 real seconds," not "every 7.5 polls."
Considered and rejected outright: `FileSystemObserver` (a real, non-standard WHATWG API,
stable in desktop Chrome/Edge 133+ on both real FSA handles and OPFS) as a push-based
replacement for polling. Mobile/Android support is unclear and plausibly absent per current
caniuse data — exactly the platform this perf work is chasing — so adopting it now risks real
effort for uncertain payoff on the platform that matters, plus it would still need a polling
fallback for Firefox/Safari/unsupported Chrome. Left as a possible future desktop-only
enhancement, not attempted here.

## Mermaid's 764kB-gzip chunk was loading on every page view — fixed at the bundle level
Prompted by the user pushing back that the `listNotes` fixes didn't explain the reported
mobile slowness, and to "measure more broadly" rather than stay anchored to the `?debug`
overlay's existing metrics. Inspected the actual production bundle (`npm run build` +
`dist/index.html`) rather than only the app's own runtime timings, and found a
`<link rel=modulepreload>` for the `mermaid` chunk fetched unconditionally on cold load —
confirmed live with a CDP `Network.requestWillBeSent` initiator trace on a folder-less visit
(no note ever opened): the chunk was fetched from a **static top-level import inside the main
entry bundle itself**, not the modulepreload link (which was a real but secondary issue, fixed
first via `build.modulePreload.resolveDependencies`, then found insufficient on its own).
Root cause: `vite.config.ts`'s `manualChunks` grouped *anything* matching `id.includes("mermaid")`
into one chunk (M28's fix for ~160 tiny per-diagram chunks blowing up GitHub Pages deploy
time). Bundling Mermaid's core + every diagram-type chunk that tightly made Rollup hoist a
shared binding out of that bucket into a forced, eager, static cross-chunk import in the main
entry — so the whole 2.8MB (764kB gzip) chunk downloaded and parsed on *every single page
load*, diagram or not. This was invisible to the `?debug` timing overlay entirely, since it's
network/parse cost that happens before any app code runs — exactly the kind of thing narrow,
in-app instrumentation can't surface, which is why the user was right to ask for broader
measurement.
Fix: replaced the manual `id.includes("mermaid")` bucket with Rollup's
`experimentalMinChunkSize: 20_000` (merges genuinely small chunks by size instead of forcing
unrelated modules to share one chunk, so it can't manufacture a cross-chunk static dependency).
Verified with the same CDP trace (now empty on a folder-less cold load) and the existing
`mermaid.spec.ts` AC-6 ("the Mermaid engine is loaded lazily") plus the offline PWA e2e, both
still green. Chunk count: 123 (vs. ~160 pre-M28, vs. 1 with the removed manual bucket); main
entry: 858.69kB (vs. 830.19kB before this change — a small, accepted growth from merging a few
shared fragments; a `100_000`-byte threshold was tried and rejected — it grew the main entry to
969kB by pulling in more than intended). Deploy-file-count is a secondary, non-user-facing
concern (borne once per deploy, not by every visitor); left for a future look if it regresses
again — not blocking, since the eager-load bug it was masking is the one that actually hurt
users.
Investigated before landing: a full-suite run surfaced `mermaid.spec.ts`'s AC-3 as "1 flaky."
A/B'd against a fresh dev-server spawn on both this change and the pre-change config
(`--repeat-each=8` each side): both flake at the same order of magnitude (1–2/8) — this test's
10s budget for the *first-ever* Mermaid dynamic import + init + render was already thin before
this change, which is exactly the category `playwright.config.ts`'s existing `retries: 1` is
there to absorb. Not a regression from more, smaller chunks; left as-is.

## `open()` reads the guessed active note concurrently with the folder listing
User-requested: opening a note shouldn't serialize behind the full `listNotes` scan. Before,
`open()` awaited the whole recursive listing, *then* read the active note's content — total
wait was list-time + read-time. Now it kicks off both at once: `listNotes(folder)` and a
speculative `readNote(folder, guess)` for the likely active note (the persisted one, or
`start.md`), so the wait is `max(list-time, read-time)` instead of their sum.
The speculative read is pure I/O — it doesn't touch `dir`/`notes`/`activeName`/the editor.
Those are only committed once `listNotes` actually succeeds, preserving the existing dead-vault
guarantee ("a folder that's gone from disk leaves the previous folder's note open, untouched" —
still covered by its original test, unchanged). Once the listing confirms the real active note
(`pickActiveNote`), the speculative read is adopted only if the guess was right; if the
persisted note vanished since last session, `activate` falls back to a normal read for the
actual one — a rare, no-worse-than-before path. `load`/`activate` gained an optional
`prefetched: NoteContent` parameter for this; every other caller is unaffected (2-arg calls
unchanged). Two new tests: one proves the read is issued while the listing is still pending
(a controllable deferred promise for `listNotes`), one proves the wrong-guess fallback loads
the real note's content, not the guessed one's. Measured on the 2018-note benchmark vault:
`listNotes` (~116ms) and the speculative `readNote` (~124ms) now overlap, so `open()` pays
~124ms for both instead of ~240ms.

## The poll's relist no longer blocks switchTo/addNote/etc. behind it in the serialize queue
User noticed real intermittent slowness switching notes in an already-open vault ("czasem
szybko, czasem długo") and correctly guessed it tracked the poll's periodic rescan. Confirmed
with a controllable-promise unit test: with the old code, `switchTo`'s `readNote` genuinely did
not fire until an in-flight `refreshFromDisk`'s `listNotes` resolved — every one of `open`,
`switchTo`, `addNote`, `removeNote`, `renameActive`, `checkDisk`, `refreshFromDisk`,
`resolveKeepMine`, `resolveTakeTheirs` shares one FIFO `serialize()` queue, so a poll tick that
happened to land on the (now 15s-throttled, but still real) full relist held that queue for the
whole scan — any user action queued behind it waited out the entire thing just to, say, switch
notes.
Fix: `refreshFromDisk` now spans two short `serialize()` slots with the slow `listNotes` call
running *between* them, not inside either — a snapshot slot (grabs `dir`/`notes`/whether a
relist is due) and an apply slot (re-validates against **live** state, not the snapshot, before
mutating). Anything queued behind the snapshot slot — a switchTo, an addNote — now runs while
the relist is still in flight, instead of waiting on it.
The one new risk this opens — some other operation changes `notes` while the relist is
in-flight and the poll's apply step later clobbers that newer state with its now-stale listing
— is guarded explicitly: the apply slot compares live `notes` against the reference captured at
snapshot time; if they differ, the fetched listing is dropped (not applied) rather than trusted,
and the next tick (15s later) re-verifies for real. `checkDisk`/`probeDisk` (the test-only
detection seam, unused by the app itself) were deliberately left untouched — this is a
production-behavior fix, not a rewrite of an already-sealed, heavily-tested contract nothing
in the app actually calls.
Three new tests: switchTo settling without waiting for an in-flight relist (a controllable
`listNotes` promise + `readNote` call assertion), the stale-relist-gets-dropped race (an
`addNote` completing mid-relist, verified via `vi.waitFor` on call count rather than assumed
microtask ordering — a naive synchronous mock setup raced the two `listNotes` calls and timed
out), and all ~30 existing `refreshFromDisk`/`checkDisk` tests pass unchanged. Measured on the
2018-note vault: switches timed to land on a poll tick stayed at ~180–270ms, no spike, vs. the
old code's queuing behind the full relist.

## Code-review pass on the above (high effort, `/code-review --fix`)
Ran the workflow-backed review on this session's three commits. 7 findings survived independent
verification; fixed 4, skipped 2 deliberately (documented below), and one is process-only (also
skipped, see below).

**Fixed:**
- **Stale cross-vault cache** (CONFIRMED, correctness): `contentCache` is keyed by relative path
  only and lives for the lifetime of one `createNoteController` instance — which `main.ts` reuses
  across every vault a window ever attaches to (M33). Every vault's seed note shares the name
  `start.md`, so switching vaults could silently serve a *previous* vault's cached `start.md`
  content under the newly-opened vault's identity — a real file-fidelity violation, pre-existing
  (from the earlier ad-hoc perf commit that added the cache) but only now caught because this
  diff's speculative-read path made it independently reachable. Fix: `contentCache.clear()` on
  every `open()`, right where `dir`/`notes` get committed. Always safe (worst case: an occasional
  extra disk read on a same-vault reopen). New test simulates two vaults sharing a `start.md` name
  with different content; confirmed it fails without the fix.
- **Relist throttle bumped even when the result was dropped as stale**: `lastFullListAt` was
  updated unconditionally whenever a relist was *attempted*, even in the branch that discards the
  result as stale (see the entry above) — so a collision didn't just lose that one check, it reset
  the 15s clock, meaning repeated collisions (e.g. a user filing several quick-capture notes within
  15s of each other) could push the "next real check" out indefinitely, contradicting the "next
  tick re-verifies" comment already in the code. Fix: only bump the timestamp when the fetched list
  is actually kept, not when dropped. New test confirms the very next tick retries the relist
  (not throttled) after a dropped/stale one; confirmed it fails without the fix.
- **Duplicated throttle-decision logic** (cleanup): `probeDisk` and `refreshFromDisk`'s snapshot
  slot each computed `now - lastFullListAt >= FULL_RELIST_MS` independently — two copies of the
  same policy that could silently drift if one were changed and not the other. Factored into one
  `isDueForRelist()` closure both call.
- **Bundle-size regression backstop** (robustness): the `modulePreload.resolveDependencies` filter
  in `vite.config.ts` matches heavy deps by package-name substring in the chunk filename —
  `experimentalMinChunkSize` groups chunks by byte size, so a future dependency bump could fold one
  of those same packages into a generically hash-named chunk the regex doesn't recognize, silently
  reproducing the exact eager-load regression this diff fixed, with nothing in the test suite that
  would catch it (vitest doesn't build the app). Added `e2e/bundle-size.spec.ts`: a permanent,
  filename-agnostic backstop — asserts a folder-less cold load against the production preview
  build downloads under 1.5MB of JS. Confirmed it fails loudly (3.6MB) when checked out against the
  pre-fix `vite.config.ts`.

**Skipped, deliberately:**
- **A narrow, timing-dependent spurious-conflict race** (PLAUSIBLE): the apply slot's `statNote`
  read can in principle land in the brief window between `doSave` physically writing a file and
  assigning the new `lastModified` to the closure — `doSave` isn't gated by `serialize()` at all
  (by design, its own separate mutex), so this race already existed before this diff in some form;
  the two-slot split widens the window (an extra out-of-lock `listNotes` await ahead of the
  `statNote` check) rather than introducing the race. A real fix means coordinating `doSave` and
  the poll's read, which is a bigger, separate piece of work than this diff's scope — flagged here
  rather than patched under time pressure.
- **Missing `Spec: FEAT-000N/AC-M` trailer** (a process-compliance finding, not a code issue): this
  was already explicitly decided during the M34 milestone review earlier in this session — ad-hoc
  performance work stays informal, outside the specman spec/seal pipeline. The finder is correct
  that CLAUDE.md's general process calls for one; the user already opted this category of work out
  of it.

## `?debug` overlay: long-task observer, visibility log, exportable history
User reports the phone still occasionally lags switching notes, despite all of the above — and
confirmed it doesn't correlate with heavier notes (rules out decoration-building cost as the cause)
and the vault isn't inside a synced folder (rules out a sync client hooking every file I/O). That
leaves something environmental — a GC pause, the poll's actual CPU work competing for the one JS
thread even though it's no longer queue-blocking, Chrome deprioritizing a backgrounded tab — none
of which desktop CPU-throttle emulation can surface, since they depend on the real device's memory
pressure and OS scheduling. Rather than guess further, extended `perf.ts` (already a permanent dev
tool per an earlier decision) to capture evidence automatically instead of needing to catch a slow
moment live:
- A `PerformanceObserver` for `longtask` entries — any main-thread stall over 50ms, whatever causes
  it, without instrumenting each suspect subsystem by hand.
- `visibilitychange` logging, since a stutter right after returning from the background reads
  identically to random jank without this.
- The rolling log now holds 500 entries (was 15, all that ever rendered) and can be copied to the
  clipboard with Ctrl+Shift+L — including a `performance.memory` snapshot — so a slow moment on the
  actual phone becomes a pasteable artifact instead of a vague report.
- Added a "Copy log" button in the overlay itself, since a phone has no Ctrl+Shift+L without a
  physical keyboard attached. It's `position:sticky` at the top of the (scrollable) overlay and
  `pointer-events:auto`, overriding the overlay container's `pointer-events:none` (which exists so
  the overlay never intercepts clicks meant for the editor beneath it) — a targeted, standard CSS
  override, not a blanket change. Its click listener is delegated on the container rather than
  attached to the button directly, since `render()` rebuilds the whole overlay's `innerHTML` on
  every entry (a listener on the button itself would be discarded each time).
No dedicated test file: `perf.ts` has never had one (its `DEBUG` gate is fixed at module-import
time from `location.search`, which isn't practically fakeable per-test in vitest) — consistent
with that established precedent for this dev-only file. Verified manually via throwaway e2e checks
(both Ctrl+Shift+L and a button click → clipboard JSON parses, has `exportedAt`/`memory`/`entries`)
before removing them. Real next step: USB remote debugging (chrome://inspect) against the actual
phone is still the gold-standard fallback if this log doesn't point anywhere on its own.

## `listNotes`'s concurrency is capped at 4, not unbounded — a real phone's `?debug` log found this
The `?debug` log paid off immediately: a captured log from the user's actual phone showed
`readNote: Apteka.md` (a single-file read) taking **1499.9ms**, versus **69.8ms** for the same kind
of read (`readNote: Allegro.md`) moments later when nothing else was going on. The difference: the
slow one ran concurrently with a `poll: listNotes` relist (2100.2ms) that happened to land at the
same moment — a ~20x slowdown for an unrelated single-file read, purely from something else doing
disk I/O on the folder tree at the same time. This is very likely the device's File System Access
implementation serializing/contending on a shared native I/O channel — not something visible from
desktop CPU throttling, which doesn't model real storage-layer contention.
`collect()`'s subfolder walk (parallelized via one unbounded `Promise.all` in an earlier round of
this same perf work) was very likely the thing generating that concurrent I/O burst. Fix: capped
total concurrent directory scans to `MAX_CONCURRENT_WALKS = 4`, via a small `Semaphore` each
recursive `collect()` call acquires before its own single-level `values()` scan and releases right
after (before recursing into children) — so at most 4 scans are ever active *across the whole
tree*, not per level. Two designs were tried and rejected first: a per-level cap (doesn't bound
total concurrency for a narrow-then-wide tree) and a worker-pool pulling from a shared queue seeded
only with the root (a genuine bug: workers spawned before the queue has more than one item exit
immediately and never come back, collapsing to single-threaded traversal for a narrow/deep tree —
caught by writing the concurrency test *before* trusting the implementation, per usual practice).
Verified with a controllable-delay fake directory handle asserting peak concurrency is `>1` and
`<=4`; confirmed it fails (peak reaches whatever the tree's fan-out is) if the cap is raised, and
would have shown peak=1 against the buggy worker-pool version. Cost on the 2018-note desktop
benchmark: `open: listNotes` back up from ~85ms to ~144ms — a real, accepted trade against real
mobile robustness, since the whole point of parallelizing this in the first place was speed that a
real device's contention apparently doesn't reward past a point. `4` is a first, reasonable guess,
not derived from more device data than this one log — worth revisiting if further `?debug` captures
say otherwise.

## The poll's relist runs at concurrency 1 — the foreground default (4) still contended
A second real `?debug` capture, after the concurrency cap above shipped: contention dropped a lot
(20x → ~6-7x — `readNote` for an unrelated note went from a clean ~75ms baseline to ~490ms, not the
earlier 1.5-2s) but didn't disappear. The user's own instinct: since the poll's relist is cyclical
and best-effort anyway, why not "cancel" it around a user action? Literal cancellation isn't a real
primitive here — the File System Access API's directory iteration (`values()`) has no `AbortSignal`,
so there's nothing to actually abort mid-scan; a cooperative "stop scheduling more work" flag
wouldn't help either, since whatever native I/O is *already* in flight keeps running (and
contending) regardless of whether our own JS stops reacting to it.
What actually fits: the poll's relist is the *only* `listNotes` caller nothing ever waits on — it
never blocks anything (that's the whole point of the two-slot `refreshFromDisk` split from earlier
in this session) and is inherently best-effort (external add/remove detection already tolerates up
to 15s of lag). A foreground `open()`/`addNote()`/etc., by contrast, has a real user waiting, so
some concurrency is worth its contention cost. Gave `listNotes` an optional `maxConcurrent` param
(default `MAX_CONCURRENT_WALKS`, i.e. unchanged for every foreground caller) and had the poll's two
call sites (`probeDisk`, `refreshFromDisk`'s snapshot slot) pass `POLL_RELIST_CONCURRENCY = 1` —
fully sequential, the smallest possible footprint, since nothing is watching it finish faster.
Two new tests: `note.test.ts` confirms `maxConcurrent: 1` genuinely serializes (peak concurrency
observed = 1, not just "≤1" — proves the parameter is honored, not just accepted and ignored);
`note-controller.test.ts` asserts the poll's `listNotes` call (both via `checkDisk` and, since
`checkDisk` itself is a test-only seam nothing in the app calls, via `refreshFromDisk` — the actual
path the production poller drives) passes `(dir, 1)` while `open()`'s call passes just `(dir)`.
Not yet re-measured on a real device (no new `?debug` capture since this landed) — the next capture
is what confirms whether this closes the remaining gap or whether the contention is dominated by
something concurrency alone can't fix (e.g. the read itself, or `open()`'s own internal contention
between its listing and its speculative read, which this change doesn't touch).

## Abandon an in-flight relist as soon as a foreground action starts (cooperative, not a true cancel)
A second real-device `?debug` capture (concurrency=1 landed but not yet re-tested) prompted the
user to ask directly: since the poll's relist is cyclical anyway, why not cancel it? Worth being
precise about what's actually possible here: the File System Access API's directory iteration
(`values()`) has no `AbortSignal` — there is no way to truly abort a scan already running at the
platform level. A scan that's *in flight right now* keeps running (and keeps contending for
whatever the phone's storage layer is bottlenecked on) no matter what our own JS does.
What *is* possible, and does help: stop starting *new* scans the moment something more important
shows up. With `POLL_RELIST_CONCURRENCY = 1`, at most one folder's scan is ever active during a
poll relist — so "stop starting new ones" shrinks the contention window from "the rest of the whole
tree" down to "whatever's already in flight for this one folder," which is the best available
without platform support.
Implementation: `listNotes` takes an optional `AbortSignal`; `collect` checks it before acquiring a
semaphore slot and again right after (in case it went stale while queued), rejecting with a
`DOMException("AbortError")` — same convention as `fetch()` — rather than ever returning a
silently-truncated listing that could be mistaken for the real disk state. `refreshFromDisk` creates
an `AbortController` for its relist and catches that specific error, folding "aborted" into the same
bucket as the existing "stale, dropped" case (no apply, no throttle-clock bump, next tick retries).
Every foreground, user-initiated operation (`open`, `switchTo`, `addNote`, `removeNote`,
`renameActive`) calls `abortPendingRelist()` — a no-op if nothing is in flight — right when it's
invoked, before even entering the `serialize()` queue, so the signal fires the instant the user
acts, not after the poll's own bookkeeping gets around to noticing. Deliberately *not* added to
`checkDisk`/`probeDisk` — that path is a test-only detection seam the app itself never calls (see
several earlier entries in this log); extending it would add surface with no real behavior to
protect.
Two new tests: `note.test.ts` proves an abort mid-walk actually stops starting new scans (visited
count stays well short of the full tree, confirmed with a naive "check once at the top" mutation
that this catches); `note-controller.test.ts` proves `switchTo` aborts an in-flight relist's signal
synchronously — confirmed failing without the `abortPendingRelist()` call.

## Also check the abort signal inside a single folder's entry loop, not just between folders
A real-device `?debug` capture after the abort mechanism above shipped showed it helping but not
closing the gap: a `readNote` still went from its ~70-100ms baseline to 444ms, overlapping a poll
relist that had started ~173ms earlier. Traced why: with `POLL_RELIST_CONCURRENCY = 1`, exactly one
folder's scan is ever active — and the abort check only ran *between* folders (before/after
acquiring a semaphore slot), never *during* one folder's own `for await (const entry of
dir.values())` loop. A folder with many entries could keep iterating for a while after being
aborted, since nothing inside that loop was watching the signal.
Fix: check `signal?.aborted` on every entry inside that loop too, throwing immediately instead of
continuing to iterate. Still can't interrupt the single in-flight `next()` call already awaited
(no platform support for that), but no longer runs an entire large folder to completion once
aborted mid-way — the third and last of the checkpoints this mechanism has: before starting a
folder's scan, right after acquiring a slot (in case it went stale while queued), and now during
the scan itself.
New test: a fake folder yielding 50 entries one at a time, aborted after the 5th — proves the
generator is never asked for a 6th, confirmed failing (ran through most/all of the 50) without the
in-loop check.
Not yet re-measured on a real device. This closes the only known remaining gap in the "stop
starting new work" approach; anything still left after this is the truly irreducible cost of
whichever single `next()` call happens to be in flight the instant the user acts — which cannot be
closed further without the platform shipping cancellation support for directory iteration.

## The poll's relist is a resumable, budgeted sweep — not one walk of the whole tree
Two more real-device `?debug` captures after the abort mechanism (both checkpoints) landed: 444ms
and 629ms — in the same ballpark as before, not shrinking further. Traced the second one: the poll
had already been running for ~965ms before the click landed, meaning whatever single directory scan
was in flight at that moment had a long head start — and per the design above, nothing can touch a
scan already in flight. The remaining lever isn't severity (already minimized) but *how much can be
"in flight" at any given moment* — which is a direct function of how long a relist attempt runs at
all. The user asked the right question: do we need to walk the *entire* tree every time?
Answer: no. `note.ts` gained a resumable primitive — `Sweep` / `startSweep` / `continueSweep` /
`sweepResult` — a breadth-first walk that can be paused after a time budget (or an abort) and
resumed later exactly where it left off, instead of `listNotes`'s "always run to completion" model.
`refreshFromDisk` now keeps one `Sweep` alive across as many poll ticks as it takes (`SWEEP_TICK_BUDGET_MS
= 400`), only starting a *new* one once the previous fully completes and `FULL_RELIST_MS` has
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
  deferred for the same reason as the walk duplication above.
