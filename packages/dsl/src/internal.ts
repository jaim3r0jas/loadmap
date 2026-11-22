// For loadmap's own packages (the editor, the docs): no promise of stability between versions
export type { Decl, Document, Edge, Expr, Ident, Property, Row, Stmt } from './ast'
export { latestEdition } from './catalog'
export { type Copies, copiesOf, LIMITS, pageOptions, type Where } from './compile'
export { closest, didYouMean, Reporter } from './diagnostics'
export {
  boxPath,
  type CopyInspection,
  type EditResult,
  type EditValue,
  edit,
  type FormulaPart,
  type InspectField,
  type Inspection,
  type InspectSection,
  type InspectTarget,
  inspect,
  inspectCopy,
  type OptionValue,
  type Provenance,
  setProperty,
  type TextChange,
  takeLine,
  writeInput,
} from './edit'
export { BUILTINS } from './expr'
export { DEFAULT_PATH, fileText, MAX_FILES, MAX_TOTAL, normalizePath, relativePath, resolvePath } from './files'
export { fingerprint, LEXICON, lex, PLUS_MINUS_MARKS, type Token } from './lexer'
export { LOOKS } from './looks'
export { MAX_DEPTH, MAX_SOURCE, parse, parseExpression } from './parser'
export { codeReference, reference } from './reference'
export { BOXES, COLORS, COMPONENT_PROPS, EDGE_PROPS, PANELS, type PropSpec, SCHEMA, STAGES } from './schema'
export { changedBoxes, type Drawn, type Range } from './track'
export { applied, intoView } from './viewblock'
