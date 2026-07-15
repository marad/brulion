---
id: FEAT-0073
title: In-app dialogs replace native confirm/prompt/alert
status: draft
depends_on: [FEAT-0012, FEAT-0069, FEAT-0070, FEAT-0072]
---

## Intent

The sidebar tree's delete confirmation, rename/new-folder naming prompts, and
move-failure feedback (built across FEAT-0012, FEAT-0069, FEAT-0070,
FEAT-0072) all use `window.confirm`/`window.prompt`/`window.alert` — a
deliberate lean shortcut at the time, but flagged live once the milestone was
tested end to end: the app already has a themed, animated overlay family
(quick switcher, command palette, move picker, conflict modal) that native
dialogs ignore completely, rendering in plain browser chrome regardless of
the app's light/dark theme. This phase replaces every one of those calls
with an in-app dialog that belongs to that same family.

## Behavior

A new dialog, mounted once over pre-declared (initially hidden) DOM — the
same shape as the existing move picker/conflict modal — offers three modes
through one shared backdrop:

- **Confirm** — a message and two buttons (Cancel, a destructive confirm
  action). Used for note delete and folder delete.
- **Prompt** — a message, a single-line text input (optionally pre-filled),
  and two buttons (Cancel, confirm). Used for new-folder naming and rename
  (note and folder).
- **Alert** — a message and a single dismiss button. Used for move/rename/
  create/delete failure feedback (e.g. an occupied destination).

Every mode dismisses the same way the existing modal family already does:
Escape, an outside (backdrop) click, or its Cancel/dismiss button all cancel
without side effects; only the confirm action proceeds. Closing restores
focus to whatever had it before the dialog opened.

## Constraints

- No controller or file-system logic changes. This phase only changes the
  trigger surface for confirmation/naming/feedback that FEAT-0012/0069/0070/
  0072 already built — every existing prompt's message text, default value,
  no-op-on-empty-or-unchanged behavior, and success/failure handling carry
  over unchanged.
- Styled and animated as one more instance of the app's existing modal
  family (matching `#conflict`'s backdrop, motion, and focus-restore), not a
  new visual language.

## Out of scope

- The "note doesn't exist yet — create it?" confirm shown when following a
  broken link (`openNotePath` in `main.ts`, FEAT-0026/FEAT-0027) — a
  different, pre-existing interaction the milestone review didn't flag.
  Left as `window.confirm` for now; a future phase can fold it into the same
  dialog if that's ever raised.
- Any change to *what* gets confirmed, prompted, or alerted — only *how* it's
  presented.

## Acceptance criteria

**AC-1** — Deleting a note asks via an in-app confirm dialog, not a native one.
Given a note row's "Delete" is chosen from its context menu,
When the confirmation is shown,
Then it renders as the app's own dialog (not `window.confirm`), and the note
is only deleted if the confirm action is chosen.

**AC-2** — Deleting a folder asks via the same in-app confirm dialog.
Given a folder row's "Delete" is chosen,
When the confirmation is shown,
Then it renders as the same in-app dialog, warning that everything beneath
it is removed, and the folder (and its contents) is only deleted on confirm.

**AC-3** — Naming a new folder uses an in-app prompt dialog.
Given "New folder" (root) or a folder row's "New subfolder…" is chosen,
When the name prompt is shown,
Then it renders as the app's own dialog with a text input (not
`window.prompt`); an empty or cancelled input creates nothing.

**AC-4** — Renaming a note or folder uses the same in-app prompt dialog.
Given a note or folder row's "Rename…" is chosen,
When the prompt is shown,
Then it renders as the in-app dialog with the input pre-filled with the
current leaf name; submitting an empty or unchanged value is a no-op, same
as before.

**AC-5** — A failed move/rename/create is reported via an in-app alert, not `window.alert`.
Given a rename, move, or folder creation is refused (e.g. the destination is
occupied),
When the failure is reported,
Then it renders as the app's own dialog with a single dismiss button, not a
native alert.

**AC-6** — Every dialog mode dismisses via Escape, outside click, or its own
cancel/dismiss control, restoring focus afterward.
Given any of the dialogs above is open,
When the user presses Escape, clicks outside it, or clicks Cancel/dismiss,
Then it closes without side effects and focus returns to the element that
had it before the dialog opened.
