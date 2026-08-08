---
id: FEAT-0089
title: Extension command icon names
status: draft
depends_on: [FEAT-0083, FEAT-0084]
---

## Intent

M39 extension commands have no compact visual identity in the action bar. The
command API gains an optional icon name as an unconstrained string, while the
JSON-like RPC boundary and host-owned rendering still prevent arbitrary SVG or
extension-provided assets from entering the UI.

## Behavior

An extension may register `icon?: string`; the API does not expose a TypeScript
union or a small input allowlist. The host treats any non-blank string as icon
metadata, resolves names that identify an icon in the bundled Lucide catalog,
and uses `puzzle` when the name is missing, blank, or not available in that
catalog. Arbitrary strings therefore cross the API without rejection, but they
cannot inject markup or assets. The namespaced command remains available in the
palette, and pinned extension actions render as compact icon-first buttons with
accessible labels.

## Acceptance criteria

- AC-1: Given a command registration with any non-blank icon string that names a
  bundled Lucide icon, when it is accepted, then the command and action carry the
  corresponding host Lucide icon.
- AC-2: Given a command registration with no, blank, or unavailable icon name,
  when it is accepted, then registration succeeds and the action uses the puzzle
  icon.
- AC-3: Given a command registration with arbitrary SVG markup or another
  untrusted string, when it crosses the RPC boundary, then it is treated only as
  an icon name and no markup or extension asset is rendered.
- AC-4: Given a pinned extension action, when the action bar renders, then it
  uses the compact icon button shape and retains an accessible label/title.
- AC-5: Given a command is registered and invoked, when its icon metadata changes
  or is unavailable, then command execution and extension isolation remain
  unchanged.
- AC-6: Given the authoring declaration is inspected, when a command's icon type
  is read, then it is `string` rather than a finite string-literal union.

## Out of scope

- Arbitrary SVG, custom icon files, remote icon packs, or runtime asset loading.
