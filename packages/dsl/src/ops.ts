// Changes to a definition's files by name: the operations an assistant, the language server and an editor share, and
// the file operations (a part, a library or a variant added, renamed or removed). An entry of its own: a page that
// only draws a definition never loads it.
export {
  type Dsl,
  type FileChange,
  type FileSet,
  headOf,
  type NewKind,
  newFile,
  pathFor,
  removeFile,
  renameFile,
  roleOf,
  underHead,
} from './fileops'
export {
  applyOperations,
  OPERATIONS,
  type Operation,
  type OperationOptions,
  type OperationsApplied,
  type OperationsRefused,
  type OperationsResult,
  type Project,
} from './operations'
