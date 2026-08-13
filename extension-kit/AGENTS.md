# Working on a Brulion extension

Keep the extension JavaScript-only and use the manifest schema, API contract,
and API version shown in the template. Read `api-contract.json` and
`brulion-extension.d.ts` before using a capability. Request the smallest
permission set: `editor:selection` never replaces content, `notifications`
never steals focus, and `dialogs` is host-owned and interactive. Catch prompt
`null` cancellation separately from accepted `""`; catch coded `timeout` and
`disposed` dialog failures. For writes, preserve the mtime from `notes.read()`
and handle `conflict`. Do not add package installation, network imports,
timers, background work, arbitrary SVG, or filesystem access. Treat the
extension folder as user-owned plain files and keep changes small enough to
review before explicit enablement.
