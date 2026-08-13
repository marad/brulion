# Signature stubs

```ts
export interface DialogElements { backdrop: HTMLElement; dialog: HTMLElement; message: HTMLElement; input: HTMLInputElement; textarea?: HTMLTextAreaElement; cancelButton: HTMLButtonElement; confirmButton: HTMLButtonElement }
export interface Dialog { confirm(message: string, confirmLabel?: string): Promise<boolean>; prompt(message: string, initialValue?: string, confirmLabel?: string): Promise<string|null>; alert(message: string): Promise<void>; destroy(): void }
export interface ExtensionDialogAdapter { alert(message: MessageContent, options: AlertOptions): Promise<void>; confirm(message: MessageContent, options: ConfirmOptions): Promise<boolean>; prompt(message: MessageContent, options: PromptOptions): Promise<string|null>; dispose(source?: string): void }
```

The body must preserve existing plain-string callers and add structured extension methods without exposing DOM.
