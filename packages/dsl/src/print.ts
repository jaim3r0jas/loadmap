import type { Expr, Stmt } from './ast'

/**
 * Statements as text the parser reads back to the same statements: what `loadmap bundle` writes, a model's files as
 * one. A number and a text are copied from where they are written (their unit, their quotes); every name is written
 * from the statement, so a name the linker gave is the one that shows. Comments are not statements and are not kept;
 * `format()` lays the result out.
 */
export function print(stmts: readonly Stmt[], source: string): string {
  // an id the linker made for a library's own value (`cost@lib/x.loadmap`) is no id a text can write: each gets one
  const taken = new Set<string>()
  const hidden = new Map<string, string>()
  const collect = (node: unknown) => {
    if (Array.isArray(node)) for (const x of node) collect(x)
    else if (node && typeof node === 'object') {
      const o = node as Record<string, unknown>
      if (typeof o.name === 'string' && !o.name.includes('@')) taken.add(o.name)
      for (const v of Object.values(o)) collect(v)
    }
  }
  collect(stmts)
  const name = (n: string): string => {
    if (!n.includes('@')) return n
    let out = hidden.get(n)
    if (out == null) {
      const base = n.slice(0, n.indexOf('@'))
      out = base
      for (let i = 2; taken.has(out); i++) out = `${base}${i}`
      taken.add(out)
      hidden.set(n, out)
    }
    return out
  }
  const PREC: Readonly<Record<string, number>> = {
    '||': 1,
    '&&': 2,
    '==': 3,
    '!=': 3,
    '<': 4,
    '<=': 4,
    '>': 4,
    '>=': 4,
    '+': 5,
    '-': 5,
    '*': 6,
    '/': 6,
    '%': 6,
  }
  const quasi = (s: string) => s.replace(/[`\\]/g, '\\$&').replace(/\$\{/g, '\\${')
  const expr = (e: Expr, min = 0): string => {
    switch (e.t) {
      case 'num':
      case 'str':
        return source.slice(e.from, e.to)
      case 'bool':
        return String(e.value)
      case 'tpl':
        return `\`${e.quasis.map((q, i) => quasi(q) + (i < e.parts.length ? `\${${expr(e.parts[i]!)}}` : '')).join('')}\``
      case 'id':
        return name(e.name)
      case 'member':
        return `${e.object.name}.${name(e.prop.name)}${e.flow ? `.${name(e.flow.name)}` : ''}`
      case 'call':
        return `${name(e.callee.name)}(${e.args.map((a) => expr(a)).join(', ')})`
      case 'unary':
        return `${e.op}${expr(e.arg, 7)}`
      case 'bin': {
        const p = PREC[e.op] ?? 0
        // a "%" between two values has spaces around it: glued to a number it would be a share
        const text = `${expr(e.left, p)} ${e.op} ${expr(e.right, p + 1)}`
        return p < min ? `(${text})` : text
      }
      case 'cond': {
        const text = `${expr(e.test, 1)} ? ${expr(e.then)} : ${expr(e.else)}`
        return min > 0 ? `(${text})` : text
      }
      case 'array':
        return `[${e.items.map((x) => expr(x)).join(', ')}]`
      case 'pm':
        return `${expr(e.value, 7)} ± ${expr(e.within, 7)}${e.percent ? '%' : ''}`
      case 'error':
        return source.slice(e.from, e.to)
    }
  }
  const body = (list: readonly Stmt[], depth: number): string =>
    list.map((s) => `${'  '.repeat(depth)}${stmt(s, depth)}`).join('\n')
  const block = (list: readonly Stmt[] | undefined, depth: number) =>
    list == null ? '' : list.length ? ` {\n${body(list, depth + 1)}\n${'  '.repeat(depth)}}` : ' {}'
  const stmt = (s: Stmt, depth: number): string => {
    switch (s.kind) {
      case 'row':
        return s.values.map((v) => expr(v)).join(' ')
      case 'prop': {
        const value = s.chain ? s.chain.map((n) => name(n.name)).join(' -> ') : expr(s.value)
        return `${s.key.name}: ${value}${s.as ? ` as ${JSON.stringify(s.as.unit)}` : ''}`
      }
      case 'edge': {
        const chain = s.chain.map((n) => name(n.name)).join(' -> ')
        return `${chain}${s.value ? `: ${expr(s.value)}` : ''}${block(s.body, depth)}`
      }
      case 'decl': {
        const args = s.args.map((a) => ` ${expr(a, 7)}`).join('')
        return `${s.keyword.name}${args}${s.init ? ` = ${expr(s.init)}` : ''}${block(s.body, depth)}`
      }
    }
  }
  return `${body(stmts, 0)}\n`
}
