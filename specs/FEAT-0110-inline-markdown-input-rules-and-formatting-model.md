---
id: FEAT-0110
title: Inline Markdown input rules and formatting model
status: draft
depends_on:
  - FEAT-0109
---

## Intent

Make inline Markdown a deliberate rich-editor input path over the loss-aware
projection. Users may type familiar emphasis and code markers, and explicit
formatting commands may create or remove the same marks, while the serialized
Markdown remains loss-aware and file-faithful. The inline model must distinguish
an incomplete or literal marker from a completed construct and must never make a
heading, block prefix, URL, or unsupported syntax disappear through inline
parsing.

## Behavior

The inline model recognizes strong emphasis (`**…**` and `__…__`), emphasis
(`*…*` and `_…_`), and inline code (`` `…` ``) only when a non-empty, unescaped
pair is complete. Imported marker spelling is retained by the projection;
newly created syntax uses canonical `**`, `*`, and `` ` `` delimiters. A pending
sequence remains visible and editable until its explicit terminating boundary.
A completed marker followed by a terminating space commits one conversion: the
visible projection contains the marked content and an ordinary trailing space,
while the source snapshot retains the Markdown delimiters. Enter, Tab, EOF,
blur, and save are explicit flush boundaries but do not guess an incomplete
marker into a mark. Empty spans, escaped delimiters, intraword underscores,
URLs, punctuation that is not a boundary, and block-prefix/heading input stay
literal or opaque according to P1. Pure toggle operations wrap a non-empty
visible selection, unwrap an imported matching mark, or create a canonical
empty pair at a caret; empty/whitespace-only selections are no-ops.

## Acceptance criteria

- AC-1: Given a visible paragraph and a completed `**…**`, `__…__`, `*…*`,
  `_…_`, or `` `…` `` sequence followed by a space, when the boundary rule is
  applied, then the returned visible projection hides only the delimiters,
  leaves the terminating space ordinary, places the caret after that space, and
  serializes the marked span with its Markdown delimiters in one model operation.
- AC-2: Given incomplete, empty, escaped, intraword-underscore, URL-adjacent,
  punctuation-adjacent, or whitespace-only marker input, when the inline rule is
  evaluated, then it remains editable literal/opaque text and no mark is
  created or source bytes dropped.
- AC-3: Given nested marks and imported `__…__`, `_…_`, or backtick syntax, when
  the document is imported and edited, then nested mark metadata is preserved,
  imported delimiter spelling remains unchanged until that span is deliberately
  rewritten, and newly created marks use canonical `**`, `*`, or backticks.
- AC-4: Given a non-empty visible selection or a caret in an existing mark, when
  the bold, italic, or code formatting operation is invoked, then it wraps the
  selection canonically or unwraps the matching imported span, preserves the
  selection direction/content, and returns one source-model operation without
  changing unrelated/unsupported source.
- AC-5: Given a pending marker at EOF or before Enter, Tab, blur, or save, when the
  flush predicate is evaluated, then only a complete non-empty construct commits;
  incomplete, escaped, empty, URL, and punctuation cases remain literal and
  editable. Repeating the operation is idempotent and undo can restore the
  pre-conversion source/model state.
- AC-6: Given a heading/block prefix, fenced/special block, link target, or
  unsupported syntax, when inline rules are evaluated, then block/special syntax
  is not consumed as an inline mark and remains available for its dedicated
  source-editing path.
- AC-7: Given an empty or whitespace-only selection, when a formatting operation
  is invoked, then it returns no operation (or creates only a canonical empty
  pair for a caret) and never emits an empty marked span.

## Out of scope

- heading, list, quote, fence, table, frontmatter, Mermaid, link, and wikilink
  input rules or special-block editing;
- CodeMirror view wiring, autosave/controller integration, clipboard, Vim,
  extension API translation, and browser E2E;
- whole-document Markdown reformatting, metadata sidecars, and HTML clipboard
  interoperability.
