import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { LEXICON, SCHEMA } from '@loadmap/dsl/internal'
import { beforeAll, describe, expect, it } from 'vitest'
import { createOnigScanner, createOnigString, loadWASM } from 'vscode-oniguruma'
import { type IGrammar, INITIAL, parseRawGrammar, Registry } from 'vscode-textmate'
import { grammar } from '../src/grammar'

const file = new URL('../syntaxes/loadmap.tmLanguage.json', import.meta.url)
const written = `${JSON.stringify(grammar(), null, 2)}\n`
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')

let tm: IGrammar
beforeAll(async () => {
  const wasm = readFileSync(createRequire(import.meta.url).resolve('vscode-oniguruma/release/onig.wasm'))
  await loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer)
  const registry = new Registry({
    onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
    loadGrammar: async () => parseRawGrammar(written, 'loadmap.tmLanguage.json'),
  })
  tm = (await registry.loadGrammar('source.loadmap'))!
})

interface Tok {
  text: string
  scope: string
  line: number
}

/** Every token of the text with its innermost scope, `.loadmap` dropped. */
function tokens(text: string): Tok[] {
  const out: Tok[] = []
  let state = INITIAL
  text.split('\n').forEach((l, line) => {
    const r = tm.tokenizeLine(l, state)
    for (const t of r.tokens) {
      const s = l.slice(t.startIndex, t.endIndex)
      if (s.trim()) out.push({ text: s.trim(), scope: t.scopes.at(-1)!.replace(/\.loadmap$/, ''), line })
    }
    state = r.ruleStack
  })
  return out
}
const scopeOf = (text: string, word: string) => tokens(text).find((t) => t.text === word)?.scope

describe('the grammar', () => {
  it('is what the schema makes (UPDATE_GRAMMAR=1 rewrites it)', () => {
    if (process.env.UPDATE_GRAMMAR) writeFileSync(file, written)
    expect(readFileSync(file, 'utf8')).toBe(written)
  })

  it('reads every statement of the language as a keyword', () => {
    const every = tokens(read('docs/every-statement.loadmap'))
    const seen = new Set(every.filter((t) => t.scope === 'keyword.other.statement').map((t) => t.text))
    // the file holds every statement of the schema (docs.test.ts)
    expect([...seen].sort()).toEqual(Object.keys(SCHEMA).filter(Boolean).sort())
  })

  it('reads both examples without a stray mark', () => {
    for (const path of [
      'examples/checkout/checkout.loadmap',
      'examples/alerts/alerts.loadmap',
      'docs/every-statement.loadmap',
    ]) {
      const t = tokens(read(path))
      // every word is something the grammar names, never plain source text
      expect(
        t.filter((x) => x.scope === 'source'),
        path,
      ).toEqual([])
    }
  })

  it('tells declarations, properties, values and formulas apart', () => {
    const text = [
      'loadmap 1',
      '# a comment',
      'load "Users" { max: 100; default: 10 }',
      'param pods "Pods" { options: [2, 4]; default: 2 }',
      'flow orders "orders" { rate: 40 * load; route: gateway -> workers }',
      'node gateway "Gateway" {',
      '  pass',
      '  capacity: estimated(20_000 ± 30%, "req/s", "a benchmark")',
      '  over: pods > 2 ? low : high',
      '}',
      'preset "Sale" { load: 20; pods: 4 }',
      'step "At 20×" { load: 20; focus: gateway }',
      'phones -> gateway',
    ].join('\n')
    const t = tokens(text)
    const at = (word: string, line: number) => t.find((x) => x.text === word && x.line === line)?.scope
    expect(at('loadmap', 0)).toBe('keyword.other.statement')
    expect(at('# a comment', 1)).toBe('comment.line.number-sign')
    expect(at('load', 2)).toBe('keyword.other.statement')
    expect(at('max', 2)).toBe('support.type.property-name')
    expect(at('default', 2)).toBe('support.type.property-name')
    expect(at('100', 2)).toBe('constant.numeric')
    expect(at('pods', 3)).toBe('entity.name.type')
    expect(at('"', 3)).toBe('string.quoted.double')
    expect(at('orders', 4)).toBe('entity.name.type')
    expect(at('load', 4)).toBe('variable.language')
    expect(at('->', 4)).toBe('keyword.operator.arrow')
    expect(at('pass', 6)).toBe('keyword.other.statement')
    expect(at('estimated', 7)).toBe('support.function.builtin')
    expect(at('20_000', 7)).toBe('constant.numeric')
    expect(at('±', 7)).toBe('keyword.operator')
    // a ternary's branches are values, not properties
    expect(at('low', 8)).toBe('variable.other')
    expect(at('high', 8)).toBe('variable.other')
    // in a preset and a step, `load:` is the property
    expect(at('load', 10)).toBe('support.type.property-name')
    expect(at('load', 11)).toBe('support.type.property-name')
    expect(at('phones', 12)).toBe('variable.other')
  })

  it('reads a template over lines, its formulas as formulas', () => {
    const t = tokens('pool workers "Workers" `${pods} pods ×\n${max(pods, 2) * 8} threads` {}')
    expect(t.find((x) => x.text === 'pods' && x.line === 0)?.scope).toBe('variable.other')
    expect(t.find((x) => x.text === 'max')?.scope).toBe('support.function.builtin')
    expect(t.find((x) => x.text.startsWith('threads'))?.scope).toBe('string.template')
    expect(scopeOf('pool workers "W" `${pods}` {}', 'workers')).toBe('entity.name.type')
  })
})

describe('the language configuration', () => {
  const config = JSON.parse(readFileSync(new URL('../language-configuration.json', import.meta.url), 'utf8'))

  it("comments and brackets are the lexer's", () => {
    expect(config.comments.lineComment).toBe(LEXICON.comment)
    for (const [open, close] of config.brackets as [string, string][]) {
      expect(LEXICON.punct).toContain(open)
      expect(LEXICON.punct).toContain(close)
    }
  })
})
