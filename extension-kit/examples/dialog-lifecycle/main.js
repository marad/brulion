export default async function activate(api) {
  await api.commands.register(
    { id: "dialog-lifecycle", label: "Ask about capture" },
    async () => {
      try {
        await api.dialogs.alert([
          { type: "strong", text: "Ready" },
          { type: "text", text: " to review this capture?" },
        ], { okLabel: "Continue" })

        const confirmed = await api.dialogs.confirm("Keep this capture?", {
          confirmLabel: "Keep",
          cancelLabel: "Discard",
        })
        if (!confirmed) return

        const value = await api.dialogs.prompt("Add a short title", {
          confirmLabel: "Use title",
          cancelLabel: "Skip",
          placeholder: "Optional title",
          multiline: false,
        })
        if (value === null) return
        console.log(value === "" ? "Accepted an empty title" : "Accepted a title")
      } catch (error) {
        if (error.code === "timeout" || error.code === "disposed") return
        throw error
      }
    },
  )
}
