# Excavation — Mermaid diagram rendering (M28 / FEAT-0056)

Top-down design artifacts for rendering ```` ```mermaid ```` fenced blocks as
diagrams in the editor, visual-only (the file bytes are never touched).

- [`01-architecture.md`](01-architecture.md) — logical modules, dependency diagram,
  edge/state tables, decisions, and the Phase 5 click-to-reveal refinement.
- [`03-signature-fit.md`](03-signature-fit.md) — adversarial signature-fit traces
  (5 scenarios incl. lazy-load + error) and their resolutions.

Implementation:
- `src/mermaid-engine.ts` — lazy `import("mermaid")` singleton + `renderMermaid`.
- `src/mermaid-render.ts` — `findMermaidBlocks`, `mermaidDecorations`,
  `MermaidWidget`, the `StateField`, and the click-to-reveal handler.
- Registered in `src/editor.ts` after `markdownRendering`; styled in `src/styles.css`.

Tests:
- `src/mermaid-render.test.ts` — unit (detection, selection-reveal, `eq`).
- `e2e/mermaid.spec.ts` — render, bytes-unchanged, reveal, error, lazy-load.

Spec: `specs/FEAT-0056-mermaid-diagram-rendering-in-fenced-blocks.md`.

Deferred: theme-matching the diagram to a future light/dark theme (M18); authoring
aids (preview pane, snippets) are out of scope.
