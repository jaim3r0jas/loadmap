import type { Operation } from '../operations'

/**
 * What a model answers, read from plain text: a few sentences, then fenced blocks. No tool calls and no JSON schema,
 * so every model can answer, a small local one too:
 *
 * - ```ops: one operation a line (`rename orderWorkers to workers`, `set db.capacity to estimated(…)`); `put` takes
 *   the statements on the lines under it, indented;
 * - ```loadmap <path>: a whole file as it should be, the fallback for a model that writes operations badly;
 * - ```questions: one question a line, when the request cannot be done without the reader;
 * - ```explore: calls to read the reader's metrics (`search cpu`, `labels http_requests_total`, `try <query>`), which
 *   the reader runs or not.
 */

export interface ExploreCall {
  tool: 'search' | 'labels' | 'try'
  /** The words, the metric's name, or the query. */
  arg: string
  /** For `try`: the window, `1h` by default. */
  window?: string
}

export interface Answer {
  /** The sentences around the blocks. */
  text: string
  operations: Operation[]
  /** Whole files by their path. */
  files: Record<string, string>
  questions: string[]
  explore: ExploreCall[]
  /** Lines of an ops block that are no operation: sent back to the model. */
  problems: string[]
}

const FENCE = /^```[ \t]*([\w-]*)[ \t]*([^\n`]*)\n([\s\S]*?)^```[ \t]*$/gm

/** The answer's blocks, read; the text left is what the reader sees. */
export function readAnswer(answer: string): Answer {
  const out: Answer = { text: '', operations: [], files: {}, questions: [], explore: [], problems: [] }
  const prose: string[] = []
  let last = 0
  for (const m of answer.matchAll(FENCE)) {
    prose.push(answer.slice(last, m.index))
    last = m.index + m[0].length
    const [, lang = '', info = '', body = ''] = m
    const kind = lang.toLowerCase()
    if (kind === 'ops' || kind === 'operations') {
      const r = readOperations(body)
      out.operations.push(...r.operations)
      out.problems.push(...r.problems)
    } else if (kind === 'loadmap' && info.trim()) out.files[info.trim().replace(/^path=/, '')] = body
    else if (kind === 'questions')
      out.questions.push(
        ...body
          .split('\n')
          .map((l) => l.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim())
          .filter(Boolean),
      )
    else if (kind === 'explore') {
      const r = readExplore(body)
      out.explore.push(...r.calls)
      out.problems.push(...r.problems)
    } else if (kind === 'loadmap') out.problems.push('a ```loadmap block names its file: ```loadmap shop.loadmap')
    else prose.push(m[0])
  }
  prose.push(answer.slice(last))
  out.text = prose
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return out
}

/** Words of a line, a text in quotes kept whole with its quotes. */
function words(line: string): string[] {
  return line.match(/"(?:[^"\\]|\\.)*"|\S+/g) ?? []
}

/** The words before `sep` (outside quotes) and after it. */
function split(ws: string[], sep: string): [string[], string[]] | undefined {
  const i = ws.indexOf(sep)
  return i < 0 ? undefined : [ws.slice(0, i), ws.slice(i + 1)]
}

/** A target and the file after `in`: `db.capacity in shop.loadmap`. */
function target(ws: string[]): { target: string; file?: string } {
  const i = ws.lastIndexOf('in')
  if (i > 0 && i === ws.length - 2 && ws[i + 1]!.endsWith('.loadmap'))
    return { target: ws.slice(0, i).join(' '), file: ws[i + 1]! }
  return { target: ws.join(' ') }
}

const ROLES = new Set(['part', 'library', 'variant'])

/** The lines of an ops block as operations, and the lines that are none. */
export function readOperations(body: string): { operations: Operation[]; problems: string[] } {
  const operations: Operation[] = []
  const problems: string[] = []
  const lines = body.replace(/\r\n/g, '\n').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const ws = words(line)
    const verb = ws[0]!.toLowerCase()
    const rest = ws.slice(1)
    const bad = (why: string) => problems.push(`"${line}": ${why}`)
    const value = (after: string) => {
      const at = line.indexOf(` ${after} `)
      return at < 0 ? undefined : line.slice(at + after.length + 2).trim()
    }
    if (verb === 'put') {
      // the statements under it: every line indented more than the put, or blank between them
      const indent = /^\s*/.exec(raw)![0].length
      const block: string[] = []
      let j = i + 1
      for (; j < lines.length; j++) {
        const l = lines[j]!
        if (l.trim() && /^\s*/.exec(l)![0].length <= indent) break
        block.push(l)
      }
      while (block.length && !block.at(-1)!.trim()) block.pop()
      const inline = rest[0] === 'in' ? undefined : line.slice(3).trim()
      const file = rest[0] === 'in' ? rest[1] : undefined
      const text = block.length ? dedent(block).join('\n') : inline
      i = j - 1
      if (!text) bad('put takes statements, on the lines under it')
      else operations.push({ op: 'put', text, ...(file && { file }) })
      continue
    }
    if (verb === 'rename' && rest[0] === 'file') {
      const s = split(rest.slice(1), 'to')
      if (s?.[0].length !== 1 || s[1].length !== 1) bad('rename file <path> to <path>')
      else operations.push({ op: 'renameFile', from: s[0][0]!, to: s[1][0]! })
    } else if (verb === 'remove' && rest[0] === 'file') {
      if (rest.length !== 2) bad('remove file <path>')
      else operations.push({ op: 'removeFile', path: rest[1]! })
    } else if (verb === 'add' && rest[0] === 'file') {
      const s = split(rest.slice(1), 'as')
      if (s?.[0].length !== 1 || !ROLES.has(s[1][0] ?? '')) bad('add file <path> as part|library|variant')
      else operations.push({ op: 'addFile', path: s[0][0]!, role: s[1][0] as 'part' })
    } else if (verb === 'rename') {
      const s = split(rest, 'to')
      if (!s?.[0].length || s[1].length !== 1) bad('rename <target> to <name>')
      else operations.push({ op: 'rename', ...target(s[0]), to: s[1][0]! })
    } else if (verb === 'set') {
      const s = split(rest, 'to')
      const v = value('to')
      if (!s?.[0].length || !v) bad('set <target> to <value>')
      else operations.push({ op: 'set', ...target(s[0]), value: v })
    } else if (verb === 'unset') {
      if (!rest.length) bad('unset <target>')
      else operations.push({ op: 'unset', ...target(rest) })
    } else if (verb === 'remove') {
      if (!rest.length) bad('remove <target>')
      else operations.push({ op: 'remove', ...target(rest) })
    } else if (verb === 'connect') {
      const s = split(rest, 'to')
      const label = value('as')
      const to = s?.[1] && (label ? s[1].slice(0, s[1].indexOf('as')) : s[1])
      if (s?.[0].length !== 1 || to?.length !== 1) bad('connect <box> to <box> [as <label>]')
      else operations.push({ op: 'connect', from: s[0][0]!, to: to[0]!, ...(label && { label }) })
    } else if (verb === 'disconnect') {
      const s = split(rest, 'from')
      if (s?.[0].length !== 1 || s[1].length !== 1) bad('disconnect <box> from <box>')
      else operations.push({ op: 'disconnect', from: s[0][0]!, to: s[1][0]! })
    } else if (verb === 'move') {
      const s = split(rest, 'to')
      if (!s?.[0].length || s[1].length !== 1) bad('move <target> to <file>')
      else operations.push({ op: 'move', ...target(s[0]), to: s[1][0]! })
    } else bad(`no operation "${ws[0]}"`)
  }
  return { operations, problems }
}

function dedent(lines: string[]): string[] {
  const indents = lines.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)![0].length)
  const n = Math.min(...indents)
  return lines.map((l) => l.slice(n))
}

function readExplore(body: string): { calls: ExploreCall[]; problems: string[] } {
  const calls: ExploreCall[] = []
  const problems: string[] = []
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const [tool = '', ...rest] = line.split(/\s+/)
    const arg = line.slice(tool.length).trim()
    if (tool === 'search' || tool === 'labels') {
      if (!arg) problems.push(`"${line}": ${tool} takes words`)
      else calls.push({ tool, arg })
    } else if (tool === 'try') {
      // try [over 6h] <query>
      const over = rest[0] === 'over' && /^\d+[mhd]$/.test(rest[1] ?? '') ? rest[1] : undefined
      const query = over ? arg.replace(/^over\s+\S+\s*/, '') : arg
      if (!query) problems.push(`"${line}": try takes a query`)
      else calls.push({ tool, arg: query, ...(over && { window: over }) })
    } else problems.push(`"${line}": no tool "${tool}": search, labels or try`)
  }
  return { calls, problems }
}
