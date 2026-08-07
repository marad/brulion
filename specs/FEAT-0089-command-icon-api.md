---
id: FEAT-0089
title: Allowlisted extension command icons
status: draft
depends_on: [FEAT-0083, FEAT-0084]
---

## Intent

M39 extension commands have no compact visual identity in the action bar. The
command API gains an optional Lucide icon name while keeping the RPC boundary
JSON-like and preventing arbitrary SVG or extension-provided assets from
entering the host UI.

## Behavior

An extension may register icon?: string. The host accepts only a bounded
allowlist of Lucide names and maps them to already-bundled icon nodes. Missing,
blank, or invalid names resolve to puzzle. The namespaced command remains
available in the palette, and pinned extension actions render as compact
icon-first buttons with accessible labels.

## Acceptance criteria

- AC-1: Given a command registration with an allowlisted icon name, when it is
  accepted, then the command and action carry the corresponding host Lucide icon.
- AC-2: Given a command registration with no, blank, or unknown icon name, when
  it is accepted, then the action uses the puzzle icon.
- AC-3: Given a command registration with arbitrary SVG markup, when it crosses
  the RPC boundary, then it is rejected or treated as an invalid name and no
  markup is rendered.
- AC-4: Given a pinned extension action, when the action bar renders, then it
  uses the compact icon button shape and retains an accessible label/title.
- AC-5: Given a command is registered and invoked, when its icon metadata changes
  or is invalid, then command execution and extension isolation remain unchanged.

## Out of scope

- Arbitrary SVG, custom icon files, remote icon packs, or runtime icon loading.
