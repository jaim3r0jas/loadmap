// the file operations live in the language package, where the assistant and the language server use them too
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
} from '@loadmap/dsl/ops'
