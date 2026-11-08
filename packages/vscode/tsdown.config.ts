import { defineConfig, type UserConfig } from 'tsdown'

// One file each, nothing left in node_modules: the extension ships as a .vsix without its dependencies. Two builds,
// so the server shares no chunk with the client (it runs in its own process, where `vscode` does not exist). Its
// `loadmap lsp` comes from the CLI, whose recorder imports Playwright only when it records: left out, never reached
const common: UserConfig = {
  format: 'cjs',
  platform: 'node',
  // VS Code 1.91's Electron
  target: 'node20',
  minify: true,
  dts: false,
  noExternal: [/^(?!vscode$|playwright)/],
}

export default defineConfig([
  { ...common, entry: { extension: 'src/extension.ts' }, external: ['vscode'] },
  { ...common, entry: { server: 'src/server.ts' }, external: [/^playwright/], clean: false },
])
