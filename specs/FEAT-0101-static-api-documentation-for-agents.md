---
id: FEAT-0101
title: Static API documentation for agents
status: draft
depends_on: [FEAT-0088, FEAT-0089, FEAT-0090]
---

## Intent

The interactive `api.html` reference currently gets its useful content only
after JavaScript imports the Authoring Kit. A coding agent or crawler that
fetches the page as plain HTML therefore sees a shell instead of the API
contract. Keep the interactive experience for people, but publish the existing
Authoring Kit guide, contract, and declarations as ordinary static files with a
visible hand-off from the HTML shell.

## Behavior

The static page includes a visible agent instruction with stable relative links
to `api.md`, `api-contract.json`, and `brulion-extension.d.ts`; the instruction
and links are present in the HTML response and remain usable when JavaScript is
disabled. The three files are copied or generated from the corresponding
`extension-kit/` sources during the build, not maintained as an independent
contract. Tests compare the checked-in/generated artifacts with those sources
and fetch the built files through the HTTP server. The existing JavaScript
enhancement still renders the human guide, generated method cards, search, and
copy controls when enabled.

## Acceptance criteria

- AC-1: Given a plain fetch of `api.html`, when an agent reads the response
  without executing JavaScript, then it finds a visible instruction identifying
  the static API hand-off and direct links to `api.md`, `api-contract.json`, and
  `brulion-extension.d.ts`.
- AC-2: Given the build's static output, when `api.md`, `api-contract.json`, and
  `brulion-extension.d.ts` are fetched, then they exist at stable `/brulion/`
  URLs, contain the current human guide, parse as the current contract, and
  expose the current TypeScript declarations.
- AC-3: Given the corresponding files in `extension-kit/`, when the static
  artifacts are checked, then their bytes are identical to the Authoring Kit
  sources; changing a source without regenerating the artifacts fails the
  verification rather than silently publishing stale documentation.
- AC-4: Given a browser with JavaScript disabled, when an agent opens the API
  page, then the static hand-off remains visible and the page does not depend on
  the enhancement script to reach the three raw files.
- AC-5: Given a browser with JavaScript enabled, when a user opens the API page,
  then the existing interactive API guide still renders its Markdown, generated
  method cards, search, and declaration surface alongside the static hand-off.

## Out of scope

- A second hand-maintained API contract, a new API version, or changes to the
  extension runtime/declarations.
- Server-side rendering of the full interactive reference or a documentation
  CMS.
- Making user-owned Markdown notes available through the app or service worker.
