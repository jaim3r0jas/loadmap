# loadmap for VS Code

[loadmap](https://jaim3r0jas.github.io/loadmap/) draws a system's architecture as a live capacity model: the load
flows through it as dots, and a ranked list says which component runs out first and at what multiple of today's
load. This extension makes VS Code an editor for its `.loadmap` files, with the help the docs' editor gives:

- highlighting made from the language's own table of statements;
- errors and failing `expect` lines as you type;
- completion with snippets, the arguments of a call, and hover with the values at the defaults;
- quick fixes, go to definition, find references, rename and an outline;
- Format Document, the one layout `loadmap fmt` writes.

The language server is `loadmap lsp` from [`@loadmap/cli`](https://www.npmjs.com/package/@loadmap/cli), bundled in:
nothing else to install, and it works offline. To use a project's own version instead (the one its CI checks with),
set `loadmap.server.path` to that command, such as `node_modules/.bin/loadmap`; in a workspace you have not
trusted, the bundled server always runs.

The language guide: https://jaim3r0jas.github.io/loadmap/language/ · MIT
