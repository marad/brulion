export default async function activate(api) {
  await api.commands.register(
    { id: "follow-task", label: "Follow today's task" },
    async () => {
      const link = await api.navigation.resolveLink("../tasks/today.md#done", {
        kind: "markdown",
        from: "Journal/week.md",
      })
      if (link.status === "missing") {
        console.warn(`Create ${link.path} explicitly before opening it`)
      } else if (link.status === "resolved") {
        const result = await api.navigation.openNote(link.path, {
          anchor: link.anchor ?? undefined,
        })
        if (result.status === "conflict") console.warn(`Review ${result.path} before navigating`)
      } else if (link.status === "external") {
        console.warn(`External link is not opened automatically: ${link.target}`)
      } else {
        console.warn(`Invalid link: ${link.target}`)
      }
    },
  )
}
