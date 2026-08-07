export default async function activate(api) {
  await api.commands.register(
    { id: "hello", label: "Hello extension", icon: "puzzle" },
    async () => {
      await api.editor.replaceSelection("Hello from Brulion")
    },
  )
}
