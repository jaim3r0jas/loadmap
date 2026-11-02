import { readFile } from 'node:fs/promises'
import { defineConfig } from 'tsdown'

// the templates are .loadmap files imported with ?raw, as Vite does in the workspace: inlined here as strings
const raw = {
  name: 'raw',
  async load(id: string) {
    if (!id.endsWith('?raw')) return null
    return `export default ${JSON.stringify(await readFile(id.slice(0, -4), 'utf8'))}`
  },
}

export default defineConfig({
  entry: ['src/index.ts', 'src/templates.ts'],
  dts: true,
  platform: 'neutral',
  plugins: [raw],
})
