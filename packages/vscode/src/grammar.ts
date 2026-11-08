import { BUILTINS, SCHEMA } from '@loadmap/dsl/internal'

/**
 * The TextMate grammar of `.loadmap`, made from the schema table so it names every statement the checker knows. It
 * reads the text the way the editor's highlighter does: a keyword only where a statement starts (a line, or after
 * `{` or `;`), the name after it as what it declares, `name:` as a property where a statement or a list item starts
 * (a ternary's `b : c` stays a value), a builtin only when a `(` follows. `syntaxes/loadmap.tmLanguage.json` is this,
 * written by `UPDATE_GRAMMAR=1 pnpm test:node`; a test fails when the two differ.
 */
export function grammar() {
  const keywords = Object.keys(SCHEMA).filter(Boolean).sort()
  const builtins = Object.keys(BUILTINS).sort()
  const start = '(?:^|(?<=[{;]))\\s*'
  const word = '[A-Za-z_]\\w*'
  return {
    $schema: 'https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json',
    name: 'loadmap',
    scopeName: 'source.loadmap',
    patterns: [{ include: '#statement' }, { include: '#property' }, { include: '#expression' }],
    repository: {
      comment: { name: 'comment.line.number-sign.loadmap', match: '#.*$' },
      statement: {
        match: `${start}\\b(${keywords.join('|')})\\b(?!\\s*:)(?:\\s+(${word}))?`,
        captures: { 1: { name: 'keyword.other.statement.loadmap' }, 2: { name: 'entity.name.type.loadmap' } },
      },
      property: {
        match: `(?:^|(?<=[{;,]))\\s*(${word})\\s*(:)`,
        captures: {
          1: { name: 'support.type.property-name.loadmap' },
          2: { name: 'punctuation.separator.key-value.loadmap' },
        },
      },
      expression: {
        patterns: [
          { include: '#comment' },
          { include: '#string-double' },
          { include: '#string-single' },
          { include: '#template' },
          { name: 'constant.numeric.loadmap', match: '\\b\\d[\\d_]*(?:\\.\\d[\\d_]*)?(?:[eE][+-]?\\d+)?' },
          { name: 'constant.language.boolean.loadmap', match: '\\b(?:true|false)\\b' },
          { name: 'support.function.builtin.loadmap', match: `\\b(?:${builtins.join('|')})\\b(?=\\s*\\()` },
          // what every formula may read; `load` where a statement starts is the keyword
          { name: 'variable.language.loadmap', match: '\\b(?:load|flows|at|demand|util|derived)\\b' },
          { name: 'keyword.operator.arrow.loadmap', match: '->' },
          { name: 'keyword.operator.loadmap', match: '===|!==|\\+/-|==|!=|<=|>=|&&|\\|\\||[-+*/%<>!?=±]' },
          { name: 'punctuation.section.block.loadmap', match: '[{}]' },
          { name: 'punctuation.section.brackets.loadmap', match: '[\\[\\]]' },
          { name: 'punctuation.section.parens.loadmap', match: '[()]' },
          { name: 'punctuation.separator.comma.loadmap', match: ',' },
          { name: 'punctuation.terminator.statement.loadmap', match: ';' },
          { name: 'punctuation.separator.key-value.loadmap', match: ':' },
          { name: 'punctuation.accessor.loadmap', match: '\\.' },
          { name: 'variable.other.loadmap', match: word },
        ],
      },
      'string-double': {
        name: 'string.quoted.double.loadmap',
        begin: '"',
        end: '"|$',
        patterns: [{ include: '#escape' }],
      },
      'string-single': {
        name: 'string.quoted.single.loadmap',
        begin: "'",
        end: "'|$",
        patterns: [{ include: '#escape' }],
      },
      // a template may run over several lines, as the lexer reads it
      template: {
        name: 'string.template.loadmap',
        begin: '`',
        end: '`',
        patterns: [
          { include: '#escape' },
          {
            name: 'meta.template.expression.loadmap',
            begin: '\\$\\{',
            end: '\\}',
            beginCaptures: { 0: { name: 'punctuation.definition.template-expression.begin.loadmap' } },
            endCaptures: { 0: { name: 'punctuation.definition.template-expression.end.loadmap' } },
            contentName: 'meta.embedded.line.loadmap',
            patterns: [{ include: '#expression' }],
          },
        ],
      },
      escape: { name: 'constant.character.escape.loadmap', match: '\\\\.' },
    },
  }
}
