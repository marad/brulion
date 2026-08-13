---
id: FEAT-0109
title: Loss-aware import and visible rich projection
status: draft
depends_on: []
---

## Intent

Give the primary CodeMirror editor a loss-aware document boundary for existing
Markdown. Import renders supported paragraph, heading, emphasis, inline-code,
blockquote, and list syntax as visible text with typed block/mark metadata and
stable UTF-16 source mappings, while unsupported syntax remains an explicit raw
island. The source file remains authoritative: loading and untouched serialization
must preserve every byte, and a deliberate visible edit may replace only its
mapped source span.

## Behavior

Import produces a deterministic visible projection and source map. Markdown
prefixes and delimiters are not visible caret stops, but their source ranges stay
addressable for source editing. Nested inline marks and multiline block lines
retain their metadata; Unicode offsets use JavaScript UTF-16 units. Unmatched or
unsupported syntax remains visible as opaque text. Serialization returns the
original source until a mapped fragment is explicitly replaced, then applies only
that fragment replacement and leaves all other source bytes unchanged.

## Acceptance criteria

- AC-1: Given Markdown containing paragraphs, headings, bold, italic, inline code,
  blockquotes, unordered lists, ordered lists, nested marks, and multiline lines,
  when it is imported, then the visible projection omits only supported prefixes
  and delimiters and every projected fragment exposes its block and mark metadata.
- AC-2: Given source containing Unicode including astral characters, when it is
  imported, then visible-to-source and source-to-visible mappings use UTF-16
  offsets, are deterministic at starts, ends, and delimiter boundaries, and never
  expose a hidden delimiter as a visible caret stop.
- AC-3: Given unknown, unmatched, or unsupported Markdown, when it is imported,
  then it remains visible in an opaque/raw region and is never silently removed or
  interpreted as a supported construct.
- AC-4: Given any imported document that has not been edited, when it is
  serialized, then the result is byte-identical, including line endings, spacing,
  delimiter choice, and unknown source.
- AC-5: Given a deliberate replacement of one visible mapped fragment, when it is
  serialized, then only that fragment's original source span is replaced and all
  unrelated spans (including opaque syntax) remain byte-identical.
- AC-6: Given an empty document or a position at a projection boundary, when a
  mapping is requested, then the result is deterministic and in bounds; invalid
  positions are rejected without mutating the document.

## Out of scope

- Markdown typing/input rules, rich formatting commands, or CodeMirror view wiring;
  those belong to FEAT-0110 and later phases.
- Persistence, autosave, conflicts, clipboard, extensions, and browser E2E.
- Parsing or interpreting frontmatter, tables, Mermaid, links, or other special
  blocks; those remain opaque until their dedicated phase.

