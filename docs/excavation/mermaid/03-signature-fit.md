# M28 / FEAT-0056 — Mermaid diagram rendering — signature-fit review

Adversarial trace of the declared signatures in `src/mermaid-render.ts` and
`src/mermaid-engine.ts` against the architecture in `01-architecture.md`. The
exercise: walk representative user scenarios through the *actual* declared
types and find where data is repacked, where a signature forces awkward
adaptation, where an error has no handler, and where an async boundary is
treated as sync. No fixes proposed — problems only.

## The declared surface under review

```
findMermaidBlocks(state: EditorState): MermaidBlock[]          // { from, to, source }
mermaidDecorations(state: EditorState): DecorationSet
class MermaidWidget extends WidgetType {
  constructor(readonly source: string)
  eq(other: MermaidWidget): boolean
  toDOM(): HTMLElement
  destroy(_dom: HTMLElement): void
  ignoreEvent(): boolean
}
renderMermaid(source: string): Promise<string>
mermaidRendering: Extension                                    // a StateField<DecorationSet> + theme
```

The architecture also states (not yet in code) that the field "Rebuilds on
`docChanged || selectionSet`."

---

## Scenario 1 — Note containing a Mermaid block opens (the lazy-load case)

**Chain:**

1. `editor.ts` registers `mermaidRendering` (a `StateField<DecorationSet>`).
   The field's `create(state: EditorState)` runs on the initial state.
2. `create` → `mermaidDecorations(state)` → `findMermaidBlocks(state)`.
   - In: `EditorState`. Out: `MermaidBlock[]`, e.g. one `{ from, to, source }`.
3. For the one block, `mermaidDecorations` constructs `new MermaidWidget(block.source)`
   — passing the `source: string` field of `MermaidBlock`, and wraps it in
   `Decoration.replace({ widget, block: true }).range(block.from, block.to)`.
   - The `from`/`to` go to `.range()`; only `source` reaches the widget ctor.
   Out: `DecorationSet`.
4. CodeMirror mounts the replace decoration and calls `widget.toDOM()`.
   `toDOM` returns a container synchronously, then (async) calls
   `renderMermaid(this.source)` → `Promise<string>`.
5. `renderMermaid` does the *first* `import("mermaid")`, caches the load promise,
   `initialize`s once, calls `mermaid.render(id, source)`, resolves the SVG
   string. The widget, on resolve, injects the SVG into the container.

**Boundary values:** all in declared types. `EditorState` → `MermaidBlock[]` →
`string` (ctor) → `Promise<string>` (SVG).

**Findings:**

- **Async boundary inside a sync `toDOM` — the gap is real but the handle is
  missing (see Scenario 4).** `toDOM(): HTMLElement` is synchronous by contract;
  the render is `Promise<string>`. The widget must hold the returned promise
  alive, attach `.then/.catch`, and write the result into a `dom` it has already
  returned. The signature gives `toDOM` no parameter and no return slot for the
  promise, so the live promise can only survive as an *implicit closure capture
  or instance field that is never declared in the surface*. That is workable
  (it's how every async widget works) but it means the cancellation contract
  lives entirely in undeclared state — the signatures don't reveal it.
- **`block: true` is assumed, not encoded.** A Mermaid diagram replacing whole
  fence-to-fence lines must be a *block* replace (like `frontmatter.ts`'s chip
  `Decoration.replace({ … block: true })`), not an inline one — otherwise CM
  rejects a line-crossing inline replace. `mermaidDecorations` returns a bare
  `DecorationSet`, so this is invisible at the signature level; a wrong choice
  here is only caught at runtime. Not a signature defect, but a load-bearing
  detail the surface cannot express. (`MermaidBlock.from/to` are "fence line to
  fence line, inclusive" per the doc, which is the correct block span.)
- **Load-once is internal to `renderMermaid`, not visible to the field.** Good:
  the lazy split lives entirely behind `renderMermaid(source)`. The field and
  widget never touch the import. This boundary is clean.

---

## Scenario 2 — User clicks into the block to edit it (reveal-on-selection)

**Chain:**

1. The click moves the caret; CM produces a transaction with `selectionSet`
   true, `docChanged` false.
2. The field's `update(value, tr)` must recompute. Per the architecture it
   rebuilds on `selectionSet`, so it calls `mermaidDecorations(tr.state)`.
3. `mermaidDecorations(state)` must drop the block the selection overlaps. To do
   that it needs **both** the blocks (`findMermaidBlocks(state)`) **and** the
   selection. It reads `state.selection` off the same `EditorState`.
4. Result: a `DecorationSet` with the touched block's widget omitted → the raw
   fenced source shows and is editable.

**Boundary values:** `EditorState` carries `.selection` and `.doc`, so
`mermaidDecorations(state)` *does* have enough to know the selection. The doc's
guiding question ("does `mermaidDecorations(state)` have enough to also know the
selection") resolves **yes** — confirmed against `markdown-render.ts`, where
`markdownSyntaxRanges(state, …)` reads `state.selection.main` the same way for
the FEAT-0026 link reveal. No extra input is needed.

**Findings:**

- **`findMermaidBlocks` returns enough for the reveal decision — barely, and at a
  cost.** The overlap test is `sel.from < block.to && sel.to > block.from`, which
  needs only `from`/`to` from each `MermaidBlock`. Those are present. So the
  scanner's return shape *does* serve both rendering (`source`) and the reveal
  (`from`/`to`). **But** `mermaidDecorations` must read the selection from a
  *different* argument (the `state`) than the blocks, then cross them itself. The
  scanner has no knowledge of selection (correct — it's pure), so the join lives
  in `mermaidDecorations`. That is fine in isolation; the awkwardness is in
  Scenario 3.
- **The field gets `tr`, not just `state` — but `mermaidDecorations` only takes
  `state`.** Every existing field here (`frontmatterField`, `blockRenderingField`)
  receives `tr` in `update` and decides *whether* to rebuild from
  `tr.docChanged` / effects / annotations, then calls its builder with
  `tr.state`. The mermaid builder signature `mermaidDecorations(state)` matches
  that pattern (builder takes the resulting state). The "rebuild on
  `docChanged || selectionSet`" gate lives in the *field's* `update`, which has
  `tr`. So **the StateField *can* rebuild correctly on `selectionSet` with only
  `EditorState` reaching the builder** — the trigger decision uses `tr`, the
  computation uses `state`. The guiding question resolves **yes**. The signature
  is sound here.

---

## Scenario 3 — User types a keystroke inside an already-rendered block elsewhere on the page (the re-render / `eq` churn case)

**Chain:**

1. A keystroke anywhere → `docChanged` transaction → field `update` →
   `mermaidDecorations(tr.state)` → `findMermaidBlocks(tr.state)`.
2. `findMermaidBlocks` re-scans the whole document and returns a *fresh*
   `MermaidBlock[]` — new objects, new `MermaidWidget` instances for every
   surviving block, even ones whose source is byte-identical to before.
3. CM diffs the old decoration set against the new. For a replace decoration at
   an unchanged range with a new widget instance, CM calls
   `oldWidget.eq(newWidget)` to decide whether to reuse the mounted DOM.
4. `eq(other: MermaidWidget)` compares `this.source === other.source`. Equal →
   CM keeps the existing DOM and *skips* `toDOM` → no re-render, no second
   `renderMermaid` call.

**Findings:**

- **`eq(other: MermaidWidget)` is the wrong declared type vs. what CodeMirror
  calls — but it is the *house* convention here, so the mismatch is uniform.**
  CodeMirror's `WidgetType.eq` is declared `eq(widget: WidgetType): boolean` —
  CM hands you the *other* widget typed as the base class. Narrowing the
  parameter to `MermaidWidget` is a parameter-type *widening-to-narrowing*
  override that TypeScript permits for method parameters only under bivariant
  checking (it is unsound in principle: CM could in theory pass a different
  `WidgetType` subclass). In practice CM only ever calls `eq` between two widgets
  at the same decoration position that are both `MermaidWidget`, so it never
  breaks — and crucially, `BulletWidget.eq(other: BulletWidget)` and
  `ToggleWidget.eq(other: ToggleWidget)` in this very codebase do exactly the
  same narrowing. So: **the declared type technically diverges from CM's
  `eq(widget: WidgetType)`, but it is the established local convention and is
  safe given CM's actual call pattern.** Flagging it as the doc asked: it is a
  type *narrowing*, not a match. No body accesses an `other`-only field beyond
  `.source`, so the narrowing buys nothing it couldn't get from a `WidgetType`
  guard — but it is consistent with the codebase.
- **Whole-document re-scan on every keystroke is implied by the signatures, with
  no incremental seam.** `findMermaidBlocks(state)` and `mermaidDecorations(state)`
  take only a full `EditorState`; there is no range or "changed region" input.
  Every transaction rebuilds the entire set from a full-document syntax-tree
  walk. `eq` then salvages the *DOM* (no re-render), but the *scan + widget
  construction* repeats wholesale. `blockSyntaxRanges` makes the same whole-doc
  choice deliberately ("block constructs are few, so a whole-doc scan is cheap"),
  so this is consistent with the house style — but worth noting the signatures
  foreclose any incremental option without a change.
- **No data is repacked needlessly in this path.** `MermaidBlock.source` flows
  straight into the ctor and is the only field `eq` compares. Clean.

---

## Scenario 4 — User selects/deletes a block while its diagram is still rendering (the cancellation / late-resolve case)

**Chain:**

1. Block is mounting: `toDOM()` returned a container, `renderMermaid(source)` is
   in flight (`Promise<string>` unresolved).
2. User selects into the block (Scenario 2) or deletes it. Either way the
   replace decoration for that block disappears from the next `DecorationSet`.
3. CM unmounts the widget and calls `destroy(_dom: HTMLElement)`. Per the doc
   this sets a per-instance `mounted = false` flag.
4. Later, the in-flight `renderMermaid` promise resolves. The widget's `.then`
   callback checks `mounted`; being false, it discards the SVG (no write to
   detached DOM).

**Findings:**

- **`destroy(dom)` has no handle to the in-flight promise — cancellation is
  *discard-on-resolve*, not real cancellation.** This is the doc's third guiding
  question, and the signature confirms the concern: `destroy(_dom: HTMLElement)`
  receives only the DOM node (and the body even ignores it — `_dom`). It has no
  reference to the `Promise<string>` `toDOM` kicked off, and `renderMermaid`
  returns a bare `Promise<string>` with **no cancellation token / no
  `AbortSignal` parameter**. So the only achievable story is: let the promise run
  to completion, then *drop the result* via the `mounted` flag. Consequences the
  signatures lock in:
  - The Mermaid render work cannot actually be stopped — CPU is spent rendering a
    diagram for a widget that no longer exists. For typical diagrams this is
    cheap; for a large/pathological diagram it is wasted work with no off-switch.
  - The `mounted` flag is *undeclared* in the class surface (`MermaidWidget` lists
    only `source`). Like the live promise in Scenario 1, the entire cancellation
    mechanism lives in instance state the signature does not expose. A reviewer
    reading only the surface cannot see how `destroy` and the late `.then` talk
    to each other.
  - **Per-instance flag vs. CM widget reuse is a latent hazard.** `eq`-based DOM
    reuse (Scenario 3) means a *new* `MermaidWidget` instance can adopt an
    *existing* mounted DOM while the *old* instance is the one that owns the
    in-flight promise and the `mounted` flag. The flag is per-*instance*; the DOM
    is shared by reuse. If `destroy` is called on the instance that owns the
    promise but the DOM lives on under a reused-equal instance, the
    flag-on-destroy reasoning must be carefully scoped to "this instance's own
    render." The signatures (`eq` reusing DOM + per-instance `destroy`) put these
    two mechanisms in the same room without a declared contract between them.
    This is the sharpest signature-level risk in the design.
- **The error branch shares this fragility (next scenario).**

---

## Scenario 5 — Invalid diagram source (the error case)

**Chain:**

1. Block source is malformed (`flowChart TZ` typo, etc.). `toDOM()` returns a
   container, calls `renderMermaid(source)`.
2. `renderMermaid` runs `mermaid.render(id, source)`, which throws/rejects on a
   parse error. `renderMermaid` propagates: the `Promise<string>` **rejects**.
3. The widget's `.catch` writes an in-place error box into the container.
4. If the import itself failed (briefly offline), `renderMermaid` *clears* the
   cached load promise so a later block can retry; the current promise still
   rejects, and this widget shows the error box.

**Findings:**

- **The error has exactly one declared handler boundary, and it is implicit.**
  The architecture's edge table names the failure owner as "widget (catches →
  error box)". But `renderMermaid(source): Promise<string>` expresses failure
  only as *rejection* — there is no typed error result, no discriminated
  `{ ok, svg } | { ok: false, message }`. So the widget must `.catch(err)` and
  render *something* from an untyped `unknown`. The signature does not say what a
  rejection carries (an `Error`? a string? Mermaid's own error object?), so the
  error-box rendering has to defensively coerce whatever Mermaid throws. The
  error path is handled, but the *shape* of the error crossing the boundary is
  undeclared — the widget adapts to an `unknown` rejection.
- **Two distinct failures collapse into one rejection.** "Source failed to
  parse/render" and "engine import failed (offline)" both surface as a rejected
  `Promise<string>`, indistinguishable at the boundary. The retry behavior
  (clear-on-failure) differs between them — an import failure should leave the
  system retryable, a parse error should not retry (retrying won't fix a typo) —
  yet `renderMermaid`'s single return type cannot tell the widget which it was.
  The doc resolves this by putting the retry logic *inside* `renderMermaid`
  (clear the load-promise slot only on import failure), so the widget never has
  to distinguish them. That keeps the boundary simple, but it means the widget's
  error box is identical for "your diagram is broken" and "we couldn't load the
  renderer" — a UX flattening the signatures make hard to avoid without a richer
  return type.
- **`mermaid.render` mutates global DOM / needs unique ids — invisible at the
  boundary.** `renderMermaid(source)` takes only `source`; the unique-id counter
  lives inside the loader (per the doc). Good: the id concern does not leak into
  the widget. Clean here.
- **Late-resolving error box has the same Scenario-4 hazard.** The `.catch` that
  writes the error box must *also* check `mounted` before touching the DOM,
  exactly like the success path. The `destroy`/promise signature gap applies
  identically to the rejection branch.

---

## Summary

Scenarios traced: lazy-load on open (1), reveal-on-selection (2), keystroke
re-render / `eq` churn (3), cancellation on delete-while-rendering (4), invalid
source / error box (5).

**What fits cleanly:**

- `mermaidDecorations(state: EditorState)` **does** have enough to know the
  selection (it reads `state.selection`, exactly as `markdown-render.ts` does for
  the link reveal). No extra input needed.
- The StateField **can** rebuild correctly on `selectionSet` with only the
  resulting `EditorState` reaching the builder: the rebuild *trigger* lives in
  the field's `update(value, tr)` (which has `tr.selectionSet`), the *computation*
  takes `tr.state`. This matches `frontmatterField` / `blockRenderingField`.
- `findMermaidBlocks` returning `{ from, to, source }` **does** serve both
  rendering (`source` → widget ctor) and the reveal-overlap test (`from`/`to`
  vs. `state.selection`). No field is unused; nothing is repacked in the happy
  path.
- The lazy split is well isolated behind `renderMermaid(source)`; the load-once
  and unique-id concerns never leak into the field or widget.

**Problems found (described, not fixed):**

1. **Cancellation is discard-on-resolve, not cancellation (Scenario 4).**
   `destroy(_dom)` gets only the DOM, and `renderMermaid` returns a bare
   `Promise<string>` with no abort mechanism. The render cannot be stopped; the
   only recourse is a `mounted` flag checked when the promise settles. Both the
   live promise and the `mounted` flag are *undeclared* instance state — the
   cancellation contract is entirely invisible at the signature surface.
2. **`eq`-based DOM reuse vs. per-instance `mounted` is an undeclared
   interaction (Scenario 4).** A new equal `MermaidWidget` can adopt an old
   instance's mounted DOM, while the old instance owns the in-flight promise and
   the per-instance flag. The two mechanisms share the same DOM with no declared
   contract between them — the sharpest signature-level risk.
3. **`eq(other: MermaidWidget)` narrows CM's actual `eq(widget: WidgetType)`
   (Scenario 3).** A divergence from the framework signature, safe only under
   bivariant parameter checking and CM's real call pattern. It is the consistent
   house convention here (`BulletWidget`, `ToggleWidget` do the same), but it is
   a *narrowing*, not a match, and the body uses nothing beyond `.source` anyway.
4. **The error boundary carries an undeclared, untyped rejection (Scenario 5).**
   `renderMermaid: Promise<string>` expresses failure only as rejection of
   `unknown`; the widget's `.catch` must coerce whatever Mermaid throws into an
   error box. Parse failure and import failure collapse into one
   indistinguishable rejection, so the error box cannot differentiate "broken
   diagram" from "renderer unavailable" without a richer return type.
5. **`block: true` and whole-document re-scan are load-bearing but invisible at
   the surface (Scenarios 1, 3).** `mermaidDecorations` returns a bare
   `DecorationSet`, so the mandatory block-level replace (line-crossing) is not
   encoded; and the `state`-only inputs foreclose any incremental scan, forcing a
   full syntax-tree walk + widget reconstruction on every transaction (salvaged
   only at the DOM level by `eq`). Both match house style but are worth stating.

## Self-Review (main agent, post-review)

Resolutions — no signature changes warranted:

- **Cancellation (sharpest finding).** The `mounted`-flag discard-on-resolve is
  sufficient: `mermaid.render` isn't abortable, so "stop" isn't achievable by any
  signature. The eq-reuse case is actually *correct* — when an equal widget replaces
  an in-flight one, CodeMirror keeps the old (still-displayed) DOM and never calls the
  new widget's `toDOM`/the old's `destroy`, so the old instance's resolving promise
  fills the DOM that is still on screen. `destroy` (real removal: block deleted or
  source changed) flips `mounted=false`, so a late resolve skips writing to detached
  DOM. The mechanism is an implementation detail, not a contract gap.
- **`unknown` rejection collapsing parse- vs import-failure.** No AC distinguishes
  them; AC-5 only requires an in-place error with a reason. The error box shows the
  message (which already reflects whichever failed). Not a signature change.
- **`eq` narrowing / `block: true` & full re-scan not on the surface.** House
  convention (`BulletWidget`, `ToggleWidget`, `frontmatterField`, `blockRenderingField`
  all do the same). The full re-scan is cheap (few blocks) and DOM work is salvaged by
  `eq`. Accepted, consistent with the codebase.

Conclusion: signatures fit the five traced scenarios; proceed to tests.
