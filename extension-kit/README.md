# Brulion Extension Authoring Kit

Kit version: 1.1.1.

Copy the template/ directory to .brulion/scripts/<id>/, change the manifest
id/name, and review the JavaScript before explicitly enabling the extension.
The workbench exposes these same files for copying and download. Its **API docs**
action opens a read-only reference window backed by `API.md`, the versioned
`api-contract.json`, and `brulion-extension.d.ts`. The contract is the structured
source for the API surface; the Markdown guide explains the human workflow.
