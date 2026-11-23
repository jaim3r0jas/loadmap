// A model's answer drawn from its Markdown: paragraphs, headings, emphasis, lists, quotes, tables, code and links,
// built as elements, never as HTML. What a model writes is untrusted: raw HTML stays text, an image is its link and is
// never loaded (it would tell another server what was asked), a link opens only http and https, in a new tab. The ops
// fence is the proposal's, drawn as its card: it is left out here. A fence still open while the answer streams is
// drawn as far as it got.
import { memo, type ReactNode, useMemo } from 'react'

type Block =
  | { kind: 'p'; text: string }
  | { kind: 'h'; level: number; text: string }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'list'; ordered: boolean; start: number; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'rule' }

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*(\S*)\s*(.*)$/
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/
const BULLET = /^ {0,3}[-*+]\s+(.*)$/
const NUMBER = /^ {0,3}(\d{1,9})[.)]\s+(.*)$/
const QUOTE = /^ {0,3}>\s?(.*)$/
const RULE = /^ {0,3}([-*_])(\s*\1){2,}\s*$/
const ROW = /^\s*\|(.*)\|\s*$/
const DIVIDER = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/

/** The fences the answer's reader takes as the model's blocks (packages/dsl answer.ts): drawn elsewhere, or not at all. */
const machine = (lang: string, info: string) => {
  const kind = lang.toLowerCase()
  return (
    ['ops', 'operations', 'questions', 'explore'].includes(kind) ||
    (kind === 'loadmap' && !!info.replace(/^path=/, '').trim())
  )
}

const cells = (line: string) => (line.match(ROW)?.[1] ?? line).split('|').map((c) => c.trim())

/** An item of a list: a bullet or a number, with what it says. */
const item = (line: string) => {
  const b = line.match(BULLET)
  if (b) return { ordered: false, n: 1, text: b[1]! }
  const n = line.match(NUMBER)
  return n ? { ordered: true, n: Number(n[1]), text: n[2]! } : undefined
}

/** The answer's blocks, line by line. */
export function blocks(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const out: Block[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) out.push({ kind: 'p', text: para.join('\n') })
    para = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const fence = line.match(FENCE)
    if (fence) {
      flush()
      const close = fence[1]!
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i]!.trimStart().startsWith(close)) body.push(lines[i++]!)
      if (!machine(fence[2]!, fence[3]!)) out.push({ kind: 'code', lang: fence[2]!, text: body.join('\n') })
      continue
    }
    if (!line.trim()) {
      flush()
      continue
    }
    const h = line.match(HEADING)
    if (h) {
      flush()
      out.push({ kind: 'h', level: h[1]!.length, text: h[2]! })
      continue
    }
    if (RULE.test(line)) {
      flush()
      out.push({ kind: 'rule' })
      continue
    }
    if (ROW.test(line) && i + 1 < lines.length && DIVIDER.test(lines[i + 1]!)) {
      flush()
      const head = cells(line)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && ROW.test(lines[i]!)) rows.push(cells(lines[i++]!))
      i--
      out.push({ kind: 'table', head, rows })
      continue
    }
    const first = item(line)
    if (first) {
      flush()
      const items = [first.text]
      // an item goes on over lines indented under it (a nested list, its code), and a blank line between two items
      // of the same kind keeps one list
      while (i + 1 < lines.length) {
        const next = lines[i + 1]!
        const it = item(next)
        if (it && it.ordered === first.ordered) items.push(it.text)
        else if (/^\s{2,}\S/.test(next)) items[items.length - 1] += `\n${next.replace(/^ {2,4}/, '')}`
        else if (!next.trim()) {
          let j = i + 2
          while (j < lines.length && !lines[j]!.trim()) j++
          const after = lines[j]
          if (after === undefined) break
          const again = item(after)
          if (!(again && again.ordered === first.ordered) && !/^\s{2,}\S/.test(after)) break
          if (!again) items[items.length - 1] += '\n'
        } else break
        i++
      }
      out.push({ kind: 'list', ordered: first.ordered, start: first.n, items })
      continue
    }
    const q = line.match(QUOTE)
    if (q) {
      flush()
      const body = [q[1]!]
      while (i + 1 < lines.length && QUOTE.test(lines[i + 1]!)) body.push(lines[++i]!.match(QUOTE)![1]!)
      out.push({ kind: 'quote', text: body.join('\n') })
      continue
    }
    para.push(line)
  }
  flush()
  return out
}

/** Only these open: a model's link to anything else (javascript:, data:) stays its text. */
const safeHref = (href: string) => {
  try {
    const u = new URL(href)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : undefined
  } catch {
    return undefined
  }
}

const INLINE =
  /(`+)([\s\S]*?[^`])\1(?!`)|!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|\*\*([\s\S]+?)\*\*|(?<!\w)__([\s\S]+?)__(?!\w)|\*([^*\s][^*]*?)\*|(?<!\w)_([^_\s][^_]*?)_(?!\w)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g

/** A line's emphasis, code and links, as elements; everything else as text. */
export function inline(text: string, key = 'i', inLink = false): ReactNode[] {
  const out: ReactNode[] = []
  let at = 0
  let n = 0
  for (const m of text.matchAll(INLINE)) {
    const start = m.index ?? 0
    if (start > at) out.push(text.slice(at, start))
    const k = `${key}.${n++}`
    if (m[1]) out.push(<code key={k}>{m[2]}</code>)
    else if (inLink && (m[4] !== undefined || m[5] !== undefined || m[11])) {
      // inside a link's text, another link (or an image, or a bare address) is its text: never an anchor in an anchor
      out.push(m[0])
    } else if (m[4] !== undefined) {
      // an image is never loaded: its link, named by its text
      const href = safeHref(m[4])
      out.push(
        href ? (
          <a key={k} href={href} target="_blank" rel="noopener noreferrer">
            {m[3] || 'image'}
          </a>
        ) : (
          m[0]
        ),
      )
    } else if (m[5] !== undefined) {
      const href = safeHref(m[6]!)
      // a link to anything else stays as it was written
      out.push(
        href ? (
          <a key={k} href={href} target="_blank" rel="noopener noreferrer">
            {inline(m[5], k, true)}
          </a>
        ) : (
          m[0]
        ),
      )
    } else if (m[7] !== undefined || m[8] !== undefined)
      out.push(<strong key={k}>{inline((m[7] ?? m[8])!, k, inLink)}</strong>)
    else if (m[9] !== undefined || m[10] !== undefined) out.push(<em key={k}>{inline((m[9] ?? m[10])!, k, inLink)}</em>)
    else if (m[11]) {
      const href = safeHref(m[11])
      out.push(
        href ? (
          <a key={k} href={href} target="_blank" rel="noopener noreferrer">
            {m[11]}
          </a>
        ) : (
          m[11]
        ),
      )
    }
    at = start + m[0].length
  }
  if (at < text.length) out.push(text.slice(at))
  return out
}

/** Lines in a paragraph keep their breaks: a model's lines are often meant as such. */
const lines = (text: string, key: string) =>
  text
    .split('\n')
    // biome-ignore lint/suspicious/noArrayIndexKey: the lines of one paragraph, in order, never moved
    .flatMap((l, i) => (i ? [<br key={`${key}b${i}`} />, ...inline(l, `${key}l${i}`)] : inline(l, `${key}l0`)))

/** An item of a list: a line or two as text, or blocks of its own (a nested list, code). */
function Item({ text, k }: { text: string; k: string }) {
  const inner = blocks(text)
  if (inner.length === 1 && inner[0]!.kind === 'p') return <>{lines(inner[0]!.text, k)}</>
  return <Blocks list={inner} prefix={k} />
}

function Blocks({ list, prefix }: { list: readonly Block[]; prefix: string }) {
  return (
    <>
      {list.map((b, i) => {
        const k = `${prefix}b${i}`
        switch (b.kind) {
          case 'p':
            return <p key={k}>{lines(b.text, k)}</p>
          case 'h': {
            // a heading inside a message stays small: the panel's own headings are the page's
            const H = b.level <= 2 ? 'h4' : 'h5'
            return <H key={k}>{inline(b.text, k)}</H>
          }
          case 'code':
            return (
              <pre key={k} data-lang={b.lang || undefined}>
                <code>{b.text}</code>
              </pre>
            )
          case 'list': {
            const items = b.items.map((text, j) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: items are in the answer's order, never moved
              <li key={j}>
                <Item text={text} k={`${k}.${j}`} />
              </li>
            ))
            return b.ordered ? (
              <ol key={k} start={b.start === 1 ? undefined : b.start}>
                {items}
              </ol>
            ) : (
              <ul key={k}>{items}</ul>
            )
          }
          case 'quote':
            return <blockquote key={k}>{lines(b.text, k)}</blockquote>
          case 'table':
            return (
              <div key={k} className="lme-md-table">
                <table>
                  <thead>
                    <tr>
                      {b.head.map((c, j) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: columns in order
                        <th key={j}>{inline(c, `${k}h${j}`)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, j) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: rows in order
                      <tr key={j}>
                        {b.head.map((_, c) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: columns in order
                          <td key={c}>{inline(r[c] ?? '', `${k}r${j}c${c}`)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          case 'rule':
            return <hr key={k} />
        }
        return null
      })}
    </>
  )
}

/** Drawn again only when its text changes: a conversation's earlier answers stay as they are while one streams. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const list = useMemo(() => blocks(text), [text])
  return <Blocks list={list} prefix="" />
})
