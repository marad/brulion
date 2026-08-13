export default async function activate(api) {
  await api.commands.register(
    { id: "selection-feedback", label: "Show selection feedback" },
    async () => {
      const selection = await api.editor.getSelection()
      await api.editor.setSelection({
        anchor: selection.head,
        head: selection.anchor,
      })
      await api.notifications.show([
        { type: "strong", text: "Selected" },
        { type: "text", text: ": " + selection.text },
      ], { level: "success" })
    },
  )
}
