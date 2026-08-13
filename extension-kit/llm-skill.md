# Brulion extension authoring skill

1. Read the manifest, `api-contract.json`, and the brulion-extension.d.ts contract.
2. Choose a lowercase safe extension id and a semantic version.
3. Start from the disabled template.
4. Use only declared permissions and the sandbox API; request the smallest
   permission set for the task.
5. For selection, preserve `{ anchor, head, text }` direction and remember that
   `editor:selection` cannot write content. Render feedback only through safe
   message parts; do not build HTML or custom UI.
6. For dialogs, distinguish prompt `null` cancellation from accepted `""` and
   catch coded `timeout`/`disposed` errors. For writes, preserve the mtime from
   `notes.read()` and handle conflicts.
7. Keep all code in JavaScript ESM and avoid packages, network imports, timers,
   and background execution.
8. Ask the user to review and explicitly enable the extension after writing it.
