# FEAT-0104 excavation decisions

- Keep MessageContent rendering in a host-only module. It consumes the validated P0 union and creates only host-owned text, `strong`, `code`, and `br` nodes; dialogs can reuse it in P3.
- Use one NotificationCenter per application live region. It owns visible/queued FIFO state, timers, dismissal, attribution, and source cleanup; no editor/controller state is reachable from it.
- Bind interaction callbacks per extension source. The host supplies its validated script id to the notification seam, while disposal clears only that source. Main's vault snapshot guard runs before enqueueing.
- Keep dialogs as explicit unavailable seams in P2. P2 changes only notification wiring and does not alter the public API version or wire contract.
