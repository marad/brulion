# Brulion Extension API

Extensions are JavaScript ESM files run in an opaque-origin sandbox. The
manifest declares the API version and permissions. Commands are namespaced as
extension-id:command-id.

The supported API is brulion.commands, brulion.editor, and the read/write note
methods documented by the declaration file. Every extension is disabled until a
user explicitly enables it in the vault.

The first kit version does not support TypeScript execution, packages, network
imports, timers, background execution, or custom UI.
