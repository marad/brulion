# Brulion Extension API

The Brulion extension API lets an explicitly enabled local JavaScript ESM
extension publish user-invoked commands and work with the active editor and the
markdown files in the granted vault. The API version is **1**.

## Start here

An extension is two ordinary files beside the notes:

```text
.brulion/scripts/daily-tools/
├── manifest.json
└── main.js
```

Use the disabled template, review the files, then enable the extension from
**Manage extensions**. New scripts are never enabled just because they exist on
disk. The least-privilege interaction examples are
`examples/selection-feedback/` and `examples/dialog-lifecycle/`; copy their
files only after reviewing them.

```js
export default async function activate(api) {
  await api.commands.register(
    { id: "insert-date", label: "Insert date", icon: "sparkles" },
    async () => {
      await api.editor.replaceSelection(
        new Date().toISOString().slice(0, 10),
      )
    },
  )
}
```

The command appears in Brulion's command palette and can be pinned to the action
bar. The command id is namespaced as `daily-tools:insert-date`. Command labels
are limited to 120 characters and descriptions to 240. The icon field accepts
any string; names found in Brulion's bundled Lucide catalog are rendered, while
missing, blank, or unavailable names use `puzzle`. The value is always treated
as a name, never as SVG or other markup.

## Manifest

`manifest.json` declares the API version and the minimum permissions. The
complete contract, including field constraints, is available in the machine-
readable `api-contract.json` file in the Authoring Kit.

```json
{
  "schemaVersion": 1,
  "apiVersion": 1,
  "id": "daily-tools",
  "name": "Daily tools",
  "version": "0.1.0",
  "entry": "main.js",
  "permissions": ["commands", "editor:write"]
}
```

- `schemaVersion` and `apiVersion` must be `1`.
- `id` is the lowercase safe directory identity.
- `version` is semantic versioning.
- `entry` is a relative `.js` ESM path with no traversal segments.
- `permissions` contains known, non-duplicated capabilities only.

## Permissions

Permissions are enforced at the host boundary. An omitted permission fails
closed before the application callback is called.

- `commands` — register and unregister commands.
- `editor:read` — read the active editor, read its selection, and focus it.
- `editor:write` — replace the active selection.
- `editor:selection` — move the primary selection without changing markdown.
- `notifications` — show bounded host-owned in-app notifications.
- `dialogs` — show bounded host-owned alert, confirm, and prompt dialogs.
- `notes:read` — list and read markdown notes.
- `notes:write` — create, guarded-write, delete, and move markdown notes.
- `navigation:read` — read the active note and resolve raw link destinations.
- `navigation:write` — open an existing note through the active notes view.

Request the smallest set that the extension needs. Note writes change files the
user owns, so handle the returned conflict status instead of overwriting a
newer external edit.

## Runtime and security

The entry runs in an opaque-origin `allow-scripts` iframe. Communication uses a
nonce-bound JSON-like `MessageChannel`. An extension cannot access Brulion's
DOM, CodeMirror instance, File System Access handles, parent storage, or the
network.

The entry may use top-level `globalThis.brulion`, export a default activation
function, or export a named `activate` function. Activation must complete before
the extension is considered ready. A failed or timed-out extension is isolated
from the notes editor and from other extensions.

The first API version does not support TypeScript execution, npm packages,
bare-module imports, remote imports, timers, background triggers, custom UI, or
arbitrary SVG. The source limit is 512 KiB. Ordinary capability calls have a five-second timeout; interactive dialogs use a 120-second deadline.

## How to use this reference

The browser reference renders the complete method contract below from
`api-contract.json`. Every method documents its permission, parameters, limits,
return value, rejection conditions, file effects, and a copyable example.

Namespaces:

- `brulion.commands` — user-invoked command registration.
- `brulion.editor` — the active editor and primary selection.
- `brulion.notes` — folder-relative markdown file operations.
- `brulion.navigation` — inspect and navigate the active notes view without exposing the DOM, URL, or filesystem handles.

## Navigation

Navigation is additive to API v1 and is separately permissioned. Request
`navigation:read` for `getActiveNote()` and `resolveLink()`; request
`navigation:write` for `openNote()`. A missing permission rejects before the host
callback runs.

```js
const active = await api.navigation.getActiveNote()
if (active) console.log(`Open note: ${active.path}`)

const link = await api.navigation.resolveLink("Journal/today#done", {
  kind: "wikilink",
})
if (link.status === "resolved") {
  const result = await api.navigation.openNote(link.path, { anchor: link.anchor ?? undefined })
  if (result.status === "conflict") console.warn(`Review ${result.path} before navigating`)
}
```

`openNote()` accepts a canonical folder-relative note path (the `.md` suffix is
optional like the notes API) and never creates a missing file. It returns
`opened`, `already-open`, `missing`, or `conflict`; a successful anchor attempt
also reports `not-requested`, `found`, or `not-found`. The controller flushes a
dirty active buffer through the normal mtime guard before switching, so a
conflict never silently overwrites another tool's edit.

`resolveLink()` receives only the raw destination and an explicit `kind` of
`markdown` or `wikilink`. Its optional `from` path defaults to the active note.
It reuses Brulion's relative-path, basename/path, anchor, external-link, and
invalid-target rules and returns `resolved`, `missing`, `external`, or `invalid`.
It does not verify heading existence, change the active note, push history, open a
browser, create a file, or mutate markdown bytes. To create and then open a
missing target, call `notes.create()` explicitly and pass the canonical path to
`openNote()`.

## Errors and result statuses

Capability calls reject when the permission is missing, arguments are unsafe,
the vault is unavailable, or the RPC call times out. Expected filesystem races
are returned as discriminated statuses instead of silently replacing content:

- `notes.create()` returns `created` or `exists`.
- `notes.write()` returns `saved` with a new `lastModified`, or `conflict`.
- `notes.move()` returns `moved`, `exists`, or `missing`.
- `notes.delete()` is idempotent when the note is already absent.
- Navigation returns discriminated `opened`/`already-open`, `missing`, and
  `conflict` results; it never implicitly creates or mutates a note.

## Safe note update

Always read the note first and pass its `lastModified` back as
`expectedLastModified` to `write()`. A missing note reads as empty content with
`lastModified: null`; passing `null` means that an existing file must not be
replaced.

```js
const current = await api.notes.read("Journal/today")
const result = await api.notes.write(
  "Journal/today",
  current.content + "\n- New item",
  current.lastModified,
)

if (result.status === "conflict") {
  console.warn("The note changed on disk; review it before retrying.")
}
```

Note paths are folder-relative POSIX paths. The `.md` suffix is optional when
calling the API and is added during normalization. `.` and `..`, the reserved
`.brulion` directory, unsafe filename characters, and paths outside the granted
vault are rejected. Paths that fail note-name validation are omitted from the
`notes.list()` listing.

## File fidelity

Notes remain ordinary `.md` files. `notes.write()` changes exactly the content
provided after its mtime guard. `notes.move()` relocates the file without
rewriting its bytes or updating links. `notes.create()` never replaces an
existing file, and deletion does not remove an empty parent folder.

## Further reading

Use the Authoring Kit's `brulion-extension.d.ts` for editor hints, the template
for a safe starting point, and `AGENTS.md` plus `llm-skill.md` when an agent is
authoring or reviewing an extension. The kit's `selection-feedback` and
`dialog-lifecycle` examples are deliberately disabled until explicit enablement.

## Interaction

Selection reads use `editor:read` and preserve direction as `{ anchor, head, text }`; `editor:selection` grants only `setSelection({ anchor, head })`. Selection offsets are zero-based UTF-16 positions. Setting a selection focuses and scrolls the editor but never writes Markdown.

Notifications and dialogs accept `MessageContent`: a string or a non-empty array of at most 32 `{ type: "text" | "strong" | "code", text }` parts. Each part is at most 2,048 UTF-16 code units and the total is at most 8,192. Labels are required plain strings of at most 80 code units; prompt initial and placeholder values are at most 4,096, and `multiline` is explicit. HTML, Markdown, links, callbacks, and arbitrary UI are not accepted.

```js
const selection = await api.editor.getSelection()
await api.editor.setSelection({ anchor: selection.head, head: selection.anchor })
await api.notifications.show([
  { type: "strong", text: "Selected" },
  { type: "text", text: ": " + selection.text },
], { level: "success" })
```

Dialogs use the existing host modal and wait FIFO behind other Brulion or
extension dialogs. Focus is restored after completion; a notification never
steals it. Prompt cancellation returns `null`, distinct from an accepted empty
string. A multiline prompt uses a textarea, while Enter confirms only a
single-line prompt. Dialog calls reject with coded `timeout` at the 120-second
human deadline or `disposed` when the extension/vault is torn down; catch both
before continuing work. The `examples/dialog-lifecycle/` directory contains a
least-privilege command that demonstrates all three dialog types and catches
those lifecycle errors. A prompt returns `string | null`:

```js
const answer = await api.dialogs.prompt("Title", {
  confirmLabel: "Save",
  cancelLabel: "Cancel",
})
if (answer !== null) console.log("Accepted title", answer)
```

For file fidelity, selection and feedback examples do not write notes. If an
extension does write, read first, pass the returned `lastModified` to
`notes.write()`, and handle `status: "conflict"`; never use a last-writer-wins
rewrite.
