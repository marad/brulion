# FEAT-0104 architecture

```text
sandbox -> RPC -> ExtensionHost validation -> source-bound callback
                                      |              |
                           MessageContent       NotificationCenter
                                                   |       |
                                          live region + timers
```

| edge | contract | failure guard |
|---|---|---|
| RPC → host | validated MessageContent + level | P0 strict validator |
| host → center | source id + content + level | active-vault callback |
| center → DOM | host-created nodes only | renderer never uses innerHTML |
| disposal → center | source-scoped clear | source id matching |

The center is independent of editor and markdown state. It is mounted once by
main and receives callbacks captured against the active vault root.
