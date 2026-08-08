# Working on a Brulion extension

Keep the extension JavaScript-only and use the manifest schema, API contract,
and API version shown in the template. Read `api-contract.json` and
`brulion-extension.d.ts` before using a capability. Do not add package
installation, network imports, timers, background work, arbitrary SVG, or
filesystem access. Treat the extension folder as user-owned plain files and
keep changes small enough to review before explicit enablement.
