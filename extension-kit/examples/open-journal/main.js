export default async function activate(api) {
  await api.commands.register(
    { id: "open-today", label: "Open today's journal" },
    async () => {
      const result = await api.navigation.openNote("Journal/today.md", { anchor: "done" })
      if (result.status === "missing") {
        console.warn("Create Journal/today.md explicitly before opening it")
      } else if (result.status === "conflict") {
        console.warn(`Review ${result.path} before navigating`)
      }
    },
  )
}
