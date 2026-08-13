# Architecture and boundary table

```mermaid
flowchart LR
  child[Sandbox extension] -->|dialogs RPC| host[ExtensionHost]
  host --> adapter[Source-scoped dialog adapter]
  adapter --> queue[Shared FIFO modal queue]
  queue --> modal[Existing host dialog DOM]
  modal --> renderer[P2 safe message renderer]
  queue --> focus[Focus capture/restore]
  runner[ExtensionRunner disposal] --> adapter
```

| Boundary | Input | Output | Owner |
|---|---|---|---|
| sandbox → RPC | bounded message/options | JSON-like result or coded error | bootstrap/peer |
| host validator | strict records + permission | typed capability call | ExtensionHost |
| adapter → modal | request record + source | answer/disposed/timeout | dialog.ts |
| modal → adapter | user event | one settlement, cleanup | dialog.ts |
| runner → adapter | source disposal | source active/queued cancellation | lifecycle |
