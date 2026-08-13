# FEAT-0102 architecture

```text
sandbox bootstrap -> nonce RPC -> ExtensionHost validators -> injected app callbacks
       |                  |                  |
 public declarations   method inventory   permissions + bounded values
```

The host is the single allowlist and validation boundary. New methods are
registered there and mirrored in the child bootstrap and Authoring Kit. Message
content is normalized but not rendered in P0. Dialog calls have a distinct
child timeout constant; host lifecycle/disposal continues through the existing
peer and runner ownership. No CodeMirror adapter or modal/toast DOM crosses this
phase.
