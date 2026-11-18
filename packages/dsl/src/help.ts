// What an editor needs beyond compiling: completion, hover, signature help, quick fixes, definitions, references and
// rename. One entry of its own in the build, so the
// pages that only read a definition never load it.

// with the help, not the compiler: a page that only draws a definition (an embed) loads none of this
export { flatten } from './bundle'
// completion itself is an entry of its own (@loadmap/dsl/completion): an editor loads it on its first list
export type { Completion, Completions } from './complete'
export type { EditResult, TextChange } from './edit'
export { type QuickFix, quickFixes } from './fixes'
export { type Hover, hover, type SignatureHelp, signatureHelp } from './hover'
export { definition, references, rename } from './references'
export {
  addImport,
  definitionAcross,
  hoverAcross,
  importersOf,
  type Located,
  libraryOf,
  referencesAcross,
  renameAcross,
  type WorkspaceOptions,
} from './workspace'
