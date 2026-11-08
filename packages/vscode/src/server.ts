import { lsp } from '@loadmap/cli'

// `loadmap lsp` as the extension ships it: the CLI's server bundled in, run on VS Code's own Node
lsp().then((code) => process.exit(code))
