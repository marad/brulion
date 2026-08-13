# Excavation decisions — formatted dialogs

- Extend the existing host modal rather than creating a second backdrop. Application callers keep plain-string `confirm`, `prompt`, and `alert` signatures; extension calls use additive structured methods.
- Store explicit request records in one FIFO queue. A source id is metadata on extension records only, allowing source cancellation without touching application records.
- Use the P2 safe renderer (text, strong, code, semantic `<br>` nodes) for both app and extension messages. No HTML/Markdown parsing crosses the boundary.
- Cancellation is represented by `null` for prompts and `false` for confirms; accepted empty prompt text remains `""`.
- Timeout/disposal errors are coded `RpcError` values and host modal cleanup is performed before the response crosses RPC.
- Prompt multiline uses a bounded textarea; single-line uses the existing input and Enter confirms only there.
