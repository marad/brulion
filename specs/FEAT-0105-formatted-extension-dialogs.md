---
id: FEAT-0105
title: Formatted extension dialogs
status: draft
depends_on: [FEAT-0102, FEAT-0104, FEAT-0083, FEAT-0084]
---

## Intent

An explicitly enabled extension sometimes needs a bounded acknowledgement,
decision, or small piece of text from the user. It must use Brulion's existing
host-owned modal conventions rather than receiving DOM access, opening native
browser dialogs, or leaving an orphaned RPC when the extension is disabled or
its vault changes. Implement formatted `alert`, `confirm`, and `prompt` with
the shared P2 message renderer and a deterministic interactive lifecycle.

## Behavior

`dialogs.alert(message, options)`, `dialogs.confirm(message, options)`, and
`dialogs.prompt(message, options)` reuse the existing single modal surface and
serialized queue. The host renders the bounded `MessageContent` from FEAT-0102
with the shared text/strong/code/newline renderer. No Markdown, HTML, links,
callbacks, extension DOM, or custom CSS crosses the boundary.

Alert shows one extension-labeled acknowledgement button (`okLabel`). Confirm
shows extension-labeled `confirmLabel` and `cancelLabel` buttons and returns a
boolean. Prompt shows the same confirm/cancel labels, a text field seeded by an
optional `initial` and `placeholder`, and returns the entered string or `null`
on cancellation. An accepted empty string remains distinct from cancellation.
When `multiline` is true, the host uses a bounded textarea; otherwise it uses a
single-line input. Enter confirms only a single-line prompt; Escape and the
cancel button cancel; backdrop clicks cancel only the extension dialog.

Only one host modal is visible at a time. Dialog requests from one or several
extensions are FIFO and wait behind the existing app dialog/conflict/settings /
move surfaces rather than superseding them. Opening a dialog records the
currently focused connected element and restores it after close where the host
modal policy permits. The dialog call resolves as soon as the user answers,
not after an extra delay. The child RPC uses the P0 120,000 ms dialog deadline;
ordinary capability deadlines remain five seconds.

Every extension dialog is tied to its source id and captured vault root. On
runner disposal, vault detachment, timeout, or explicit adapter disposal, the
active dialog closes and queued requests are rejected with a coded `disposed`
error. Focus is restored, the backdrop is hidden, timers/listeners are removed,
and no late answer invokes an old callback or resolves a new extension's dialog.
The existing application dialog's behavior remains compatible for its current
plain-string callers.

## Acceptance criteria

- AC-1: Given an alert, confirm, or prompt with valid plain or formatted
  `MessageContent`, when it opens, then the host modal contains only host-owned
  text/strong/code/br nodes, shows the supplied plain-text labels, and renders
  semantic newlines without interpreting HTML, Markdown, links, or nested
  values.
- AC-2: Given a confirm call, when the user presses its labeled confirm or
  cancel button, Escape, or the allowed backdrop dismissal, then the RPC
  resolves respectively to `true` or `false`; labels identify the buttons and
  no other modal surface is dismissed.
- AC-3: Given a prompt with single-line or multiline options, initial text,
  placeholder, and either outcome, when the user confirms or cancels, then the
  host uses the requested input control, preserves the initial/placeholder
  values, returns the exact entered UTF-16 string or `null`, and distinguishes
  accepted empty text from cancellation.
- AC-4: Given a dialog call with malformed/oversized message, unknown option,
  unsupported label, invalid multiline value, or missing `dialogs` permission,
  when it crosses the host boundary, then it rejects before opening a modal or
  invoking the dialog adapter.
- AC-5: Given multiple dialog requests while another Brulion modal or extension
  dialog is active, when they are answered in sequence, then they are FIFO,
  exactly one modal is visible, and focus is restored after each completed
  request without starving a queued request.
- AC-6: Given an extension with an active or queued dialog, when it is disabled,
  disposed, or its vault is detached, then the active UI closes, queued and
  active RPC calls reject immediately with `disposed`, focus is restored, and
  no callback or late response can affect a replacement extension/vault.
- AC-7: Given an unanswered dialog, when the human-scale deadline expires,
  then the sandbox receives a coded `timeout` rejection, the host closes and
  cleans up the associated modal, and a later dialog can open normally.
- AC-8: Given a real Chromium/OPFS enabled extension, when user-invoked commands
  call alert, confirm, and prompt, then the browser observes formatted content,
  custom labels, both confirm outcomes, single-line/multiline input, empty vs
  cancelled prompt results, disposal/timeout cleanup, and unchanged Markdown
  bytes through the real iframe/RPC path.

## Out of scope

- System/OS dialogs or notification permissions, choose/picker APIs, clipboard,
  automatic events, timers/background execution, custom extension UI, DOM/FSA
  handles, packages, TypeScript, network access, and changes to Markdown bytes.
- New dialog types or changing the API version/message bounds/permission model.

