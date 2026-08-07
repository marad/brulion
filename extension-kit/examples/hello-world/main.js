export default async function activate(api) {
  await api.commands.register(
    { id: "insert", label: "Insert hello", icon: "sparkles" },
    async () => api.editor.replaceSelection("Hello from Brulion"),
  )
}
