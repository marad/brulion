Create a Brulion local extension from the bundled template. Read
`api-contract.json` and `brulion-extension.d.ts` first. Keep it JavaScript ESM,
validate manifest schemaVersion 1 and apiVersion 1, declare the minimum
permissions, and use only the documented API. For selection feedback, preserve
`{ anchor, head, text }` direction and request `editor:selection` only when
needed; use `MessageContent` rather than HTML. For dialogs, keep `null`
cancellation distinct from accepted `""`, and catch coded `timeout` and
`disposed` errors. For note updates, preserve the mtime returned by
`notes.read()` and handle a `conflict` result rather than silently overwriting
external edits. Do not use TypeScript, packages, network imports, timers,
background execution, arbitrary SVG, or direct filesystem access. Leave the
extension disabled and explain the files changed so a user can review and
explicitly enable it.
