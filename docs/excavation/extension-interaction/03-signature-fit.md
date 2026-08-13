# Signature-fit and self-review

- `ExtensionSelection` changes from normalized `from/to` to direction-aware
  `anchor/head`; application adapters can later validate document bounds.
- Host callback seams are additive: `setSelection`, notification `show`, and
  dialog `alert/confirm/prompt` return bounded JSON-like values.
- Permission mapping is one-to-one and fail-closed; existing mappings are not
  changed.
- Unknown fields are rejected at each new wire object. Rendering and modal
  queue behavior intentionally remain deferred to P1–P3.
