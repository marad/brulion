# Local extensions

Brulion can run explicitly enabled JavaScript extensions from the open vault:

```text
.brulion/
└── scripts/
    └── daily-tools/
        ├── manifest.json
        └── main.js
```

The app validates the folder id, manifest, entry path, permissions, and source
size before it starts anything. A script is disabled by default; use **Manage
extensions → Enable** after reviewing its files. The enablement list is stored in
`.brulion.json` and travels with the vault.

## Manifest

```json
{
  "schemaVersion": 1,
  "apiVersion": 1,
  "id": "daily-tools",
  "name": "Daily tools",
  "version": "0.1.0",
  "entry": "main.js",
  "permissions": ["commands", "editor:read", "editor:write", "notes:read"]
}
```

Supported permissions are `commands`, `editor:read`, `editor:write`,
`notes:read`, and `notes:write`. Missing permissions fail closed at the host
boundary before an application callback is called.

## Source contract

The entry is an ESM module. It may register commands at top level through the
global `brulion` object, or export a default activation function:

```js
export default async function activate(api) {
  await api.commands.register(
    { id: "insert-date", label: "Insert date", description: "Add today's date" },
    async () => {
      const selection = await api.editor.getSelection()
      await api.editor.replaceSelection(new Date().toISOString().slice(0, 10))
      await api.editor.focus()
      return { replaced: selection.text }
    },
  )
}
```

The same API is available as `globalThis.brulion`. Commands appear in Brulion's
existing command palette and action bar under `<script-id>:<command-id>`.

The module runs in an opaque-origin `allow-scripts` iframe. It receives only
JSON-like values over a nonce-bound `MessageChannel`; it cannot access Brulion's
DOM, CodeMirror instance, File System Access handles, network, or parent storage.
The current MVP intentionally does not transpile TypeScript, install packages,
allow imports from the network, or provide a Brulion timer/trigger API or custom
UI.

Agents can create or update these ordinary files, but enabling and reviewing a
script remains a user decision.
