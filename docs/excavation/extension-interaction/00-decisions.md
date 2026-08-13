# FEAT-0102 interaction boundary decisions

- Keep API version 1 and add only optional permissions: `editor:selection`, `notifications`, and `dialogs`; existing manifests and grants remain valid.
- Preserve direction with `{ anchor, head, text }`; `editor:selection` grants only `setSelection`, while selection reads remain under `editor:read`.
- Use one strict bounded message language for notifications and dialogs: string or non-empty `MessagePart[]` (`text`, `strong`, `code`), max 32 parts / 2,048 code units per part / 8,192 total.
- Keep host rendering and lifecycle ownership out of P0. P0 exposes validated callback seams and wire declarations only.
- Ordinary RPC remains 5,000 ms; dialog requests use a named 120,000 ms child deadline. Disposal remains the existing nonce-bound `disposed` error.
