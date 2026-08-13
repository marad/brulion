# Signature-fit self-review

- Existing `Dialog` methods remain source-compatible for app call sites.
- Structured extension methods are supplied through `ExtensionInteractionCapabilities`, avoiding contract drift.
- Source cancellation is separate from `destroy()`: destroy rejects extension requests and closes only the extension-owned active record; app records continue.
- The adapter is injected into the existing host lifecycle and disposed before RPC peer shutdown.
- `textarea` is optional at the mount seam to keep tests and legacy hosts compatible; the production DOM supplies it.
