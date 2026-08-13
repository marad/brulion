# Brulion Extension Authoring Kit

Kit version: 1.3.0.

Copy the template/ directory to .brulion/scripts/<id>/, change the manifest
id/name, and review the JavaScript before explicitly enabling the extension.
The `examples/open-journal/` example shows a least-privilege fixed-note open;
`examples/resolve-and-open/` resolves a markdown destination before deliberately
opening only an existing result. Neither example creates a missing note
implicitly. The `selection-feedback` and `dialog-lifecycle` examples demonstrate
least-privilege interaction permissions and remain disabled until explicit
enablement. The workbench exposes these same files for copying and download. Its
**API docs** action opens a read-only reference window backed by `API.md`, the
versioned `api-contract.json`, and `brulion-extension.d.ts`. The contract is the
structured source for the API surface; the Markdown guide explains the human
workflow, including safe formatted messages, prompt outcomes, and coded
`timeout`/`disposed` lifecycle errors.
