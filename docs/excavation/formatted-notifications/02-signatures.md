# FEAT-0104 signature stubs

```ts
export function renderMessageContent(root: HTMLElement, content: MessageContent): void
export interface NotificationCenterHandle {
  show(source: string, content: MessageContent, level: NotificationLevel): void
  clearSource(source: string): void
  clear(): void
}
export function mountNotificationCenter(region: HTMLElement): NotificationCenterHandle
```

The implementation must preserve the existing `ExtensionInteractionCapabilities`
callback shape except for the internal source attribution seam.
