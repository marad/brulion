---
id: FEAT-0104
title: Formatted extension notifications
status: draft
depends_on: [FEAT-0102, FEAT-0083, FEAT-0084]
---

## Intent

An explicitly enabled extension needs a small, non-blocking way to tell the
user that a command completed or needs attention, without taking over the
browser's notification system or injecting markup into Brulion. Implement the
host-owned message renderer and in-app notification surface behind the already
permission-gated `notifications.show()` RPC. The feature must remain ordinary
UI state: it never changes the Markdown document or grants DOM, clipboard,
network, or system-notification access.

## Behavior

The host renders a `MessageContent` value as safe DOM owned by Brulion. A plain
string and each `text` part produce text nodes; `strong` parts use a host-owned
`<strong>` element and `code` parts use a host-owned `<code>` element. Every
newline in a fragment becomes a `<br>` node. The renderer never assigns
`innerHTML`, parses Markdown, follows links, accepts nested parts, or copies
extension elements/classes into the document. The P0 wire validator remains
the single source of bounds and shape validation.

`notifications.show(message, options?)` enqueues a host-owned toast and returns
without waiting for dismissal or moving keyboard focus. The host applies the
validated `info`, `success`, `warning`, or `error` level (default `info`),
shows the originating extension's safe id as attribution, and provides an
accessible dismiss button. Toasts live in a dedicated `aria-live="polite"`
region outside the editor; they do not use the modal dialog or conflict
backdrop.

To keep a noisy extension from taking over the chrome, at most three toasts
are visible at once and at most eight more wait in FIFO order. A ninth incoming
notification is dropped newest-first. Each visible toast auto-dismisses after
four seconds; manual dismissal promotes the next queued toast immediately.
Disposal removes all toasts and queued entries owned by the disposed extension
(or all entries when the vault is detached), and a stale-vault callback is
rejected before enqueueing. Notification rendering and timers are isolated from
the editor, autosave, conflicts, and note polling.

## Acceptance criteria

- AC-1: Given a valid plain message or `MessagePart[]`, when the host renders
  it into a notification, then text, strong, and code fragments appear as
  host-created nodes, every newline appears as a `<br>`, and the visible text
  matches the source exactly without `innerHTML` or Markdown interpretation.
- AC-2: Given message content containing HTML-looking text, links, nested
  objects, unsupported part types, or values outside the P0 bounds, when
  `notifications.show()` is called, then the host rejects before rendering and
  the notification region and editor remain unchanged.
- AC-3: Given an enabled extension with the `notifications` permission, when
  it calls `notifications.show()` with each severity and with omitted options,
  then a host-owned toast appears with the matching level (or `info` by
  default), safe attribution, and an accessible dismiss control; given no
  permission, the injected notification callback is not called.
- AC-4: Given a notification call, when it is accepted, then the RPC resolves
  after enqueueing without waiting for auto-dismissal, keyboard focus remains
  on the previously focused element/editor, and no Markdown document, mtime,
  selection, or save callback changes.
- AC-5: Given more than three visible notifications and queued notifications,
  when they are shown and dismissed or expire, then only three are visible,
  queued items are promoted FIFO, the ninth excess item is dropped, and no
  unbounded DOM/timer growth occurs.
- AC-6: Given an extension runner is disposed or its captured vault is
  detached, when its notifications are pending or visible, then its owned
  notifications are removed, later stale calls reject before enqueueing, and
  another active vault/extension's notifications are not removed by a
  different source disposal.
- AC-7: Given a real Chromium page with an OPFS-backed enabled extension, when a
  user-invoked command calls `notifications.show()` with formatted content,
  then the toast crosses the opaque iframe/RPC boundary and is visible in the
  host while the active note bytes remain unchanged.

## Out of scope

- System/OS notifications, browser notification permission prompts, dialog
  interaction, action buttons, links, custom extension UI, arbitrary HTML/CSS,
  clipboard, and notification-change events.
- Changing the public API version or the P0 message/permission contract.
- Persisting notifications or exposing their state to another extension.

