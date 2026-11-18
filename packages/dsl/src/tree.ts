// The help's walks over the syntax tree: completion, hover and the fixes share them. A module of their own, so the
// compiler's modules (which every embed loads) carry none of their code.
import { childrenOf, type Decl, type Edge, type Expr, type Stmt } from './ast'
import { type BlockSpec, own, SCHEMA } from './schema'

/** The value of a property a declaration writes in its block. */
export function propOf(d: Decl, key: string): Expr | undefined {
  const p = d.body?.find((s) => s.kind === 'prop' && s.key.name === key)
  return p?.kind === 'prop' ? p.value : undefined
}

/** Every formula in the statements, and every formula inside it. */
export function walk(list: readonly Stmt[], visit: (e: Expr) => void) {
  const expr = (e: Expr) => {
    visit(e)
    for (const c of childrenOf(e, true)) expr(c)
  }
  for (const s of list) {
    if (s.kind === 'prop') expr(s.value)
    else if (s.kind === 'row') s.values.forEach(expr)
    else {
      if (s.kind === 'decl') {
        s.args.forEach(expr)
        if (s.init) expr(s.init)
      } else if (s.value) expr(s.value)
      if (s.body) walk(s.body, visit)
    }
  }
}

/** The innermost block whose braces hold `offset`, and the statements whose blocks lead to it. */
export function blockAt(
  body: readonly Stmt[],
  offset: number,
): { spec: BlockSpec; edgeBody: boolean; path: (Decl | Edge)[] } {
  let spec = SCHEMA['']!
  let list = body
  const path: (Decl | Edge)[] = []
  for (;;) {
    const inside = list.find(
      (s): s is Decl | Edge =>
        (s.kind === 'decl' || s.kind === 'edge') && !!s.bodySpan && s.bodySpan.from < offset && offset < s.bodySpan.to,
    )
    if (!inside?.body) return { spec, edgeBody: false, path }
    path.push(inside)
    // an edge's block holds label and when
    if (inside.kind === 'edge') return { spec, edgeBody: true, path }
    const next = own(SCHEMA, inside.keyword.name)
    if (!next) return { spec, edgeBody: false, path }
    spec = next
    list = inside.body
  }
}
