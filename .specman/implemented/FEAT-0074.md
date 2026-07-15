---
id: FEAT-0074
title: "Text inputs don't invite password-manager autofill suggestions"
status: draft
depends_on: []
---

## Intent

Password-manager browser extensions (Bitwarden and similar) scan visible
text inputs and offer to fill saved logins into them. None of Brulion's text
fields are login fields, but a blank single-line input sitting next to a
confirm/cancel button — exactly the shape of the rename dialog once its
value is cleared — looks enough like an empty credential prompt that these
extensions offer suggestions anyway. This is a distraction with no upside
for a note-taking app; the fix is the standard set of hints web apps use to
opt a field out of that heuristic, applied to every plain text input Brulion
renders.

## Behavior

Every plain single-line text input in the app — the quick switcher, the
command palette, the "Move to…" picker, the confirm/prompt dialog
(FEAT-0073), the header's inline note-rename field (FEAT-0035), and the
settings modal's journal-path field — carries `autocomplete="off"` plus the
vendor-specific opt-out attributes several password managers respect
(`data-lpignore`, `data-1p-ignore`, `data-bwignore`) and a generic
`data-form-type="other"` hint some extensions and form-detection scripts
also honor. This is best-effort, not a guarantee: no combination of HTML
attributes reliably suppresses every password manager in every
configuration, but it's the same mitigation other web apps use and removes
the suggestion in the common case.

## Constraints

- No behavior change to any field beyond the added attributes — filtering,
  validation, and submission are untouched.
- Applied uniformly; no text field is deliberately left without the hints.

## Out of scope

- Radio buttons, checkboxes, and other non-text form controls (settings
  modal) — password managers don't target these.
- A guarantee that every browser/extension combination stops suggesting —
  best-effort only.

## Acceptance criteria

**AC-1** — Every static text input carries the anti-autofill attributes.
Given the switcher, command palette, move picker, and confirm/prompt dialog
inputs declared in `index.html`,
When any of them is inspected,
Then each carries `autocomplete="off"`, `data-lpignore="true"`,
`data-1p-ignore`, `data-bwignore="true"`, and `data-form-type="other"`.

**AC-2** — Every dynamically created text input carries the same attributes.
Given the header's inline note-rename input and the settings modal's
journal-path input,
When either is created,
Then it carries the same attribute set as AC-1.
