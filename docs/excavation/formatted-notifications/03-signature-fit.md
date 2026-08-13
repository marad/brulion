# FEAT-0104 signature-fit review

- `showNotification(message, options, source)` keeps public RPC unchanged while
  adding attribution only to the internal host callback seam.
- `dispose(source)` is source-scoped; this prevents one runner from clearing a
  different runner's visible and queued entries.
- Main binds every interaction callback to the captured vault root and asserts
  that root immediately before enqueueing, so stale calls cannot affect a newly
  attached vault.
- NotificationCenter has no editor, note, or filesystem dependency; timers and
  DOM are owned entirely by the dedicated live region.
