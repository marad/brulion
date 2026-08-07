# Brulion extension authoring skill

1. Read the manifest and the brulion-extension.d.ts contract.
2. Choose a lowercase safe extension id and a semantic version.
3. Start from the disabled template.
4. Use only declared permissions and the sandbox API.
5. Keep all code in JavaScript ESM and avoid packages, network imports, timers,
   and background execution.
6. Ask the user to review and explicitly enable the extension after writing it.
