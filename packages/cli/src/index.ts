import { readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, join, normalize } from 'node:path'
import { parseArgs } from 'node:util'
import { compile, formatDiagnostic } from '@loadmap/dsl'
import type { PageRecorder } from '@loadmap/export'
import { chromium } from 'playwright'
import { check } from './check'

export { type CheckOptions, check, github } from './check'

export const USAGE = `loadmap check <file.loadmap>… [--format text|github]
loadmap record <url | file.loadmap> --out <file.gif|.webm|.mp4|.png|.svg> [options]

check compiles each definition and tests its expect lines on the pessimistic edge (every capacity at its low
bound). It exits 1 when a definition has an error or an expectation fails, 0 when everything holds.

  --format <f>          text, or github to add annotations on the lines (the default under GitHub Actions)

record opens the page in headless Chromium, finds the loadmap it exposes (expose() from @loadmap/export) and
records it on a fixed clock, so the same options give the same file. A .loadmap file is drawn by the viewer that
comes with the command.

  --out <file>          the extension picks the format: gif, webm, mp4, png or svg
  --script <file.json>  [{ "at": 0, "set": { "load": 5 } }, { "at": 3, "scenario": "Proposed" }, …]
                        or { "seconds", "fps", "script": […] }
  --scenario <label>    start from a scenario's values (--set goes on top)
  --set <key=value>     a value before recording starts; repeatable (--set load=30 --set pods=6)
  --caption             the title, scenario and load above the board, the verdict below it
  --story               play the definition's story, a step at a time (with --caption, its text below the board)
  --poster              with .png: the board, the verdict, the limits and the scenarios compared
  --seconds <n>         length of a video or GIF (default 8, or the script's)
  --fps <n>             frames per second (default 30; GIF 15, at most 50)
  --scale <n>           pixels per diagram unit (default 1, PNG 2)
  --seed <n>            the sim's seed (default 1)
  --name <name>         which exposed loadmap, when the page has several (default "default")
  --width <px>          the browser window (default 1280; below 640 the diagram runs top to bottom)
  --color-scheme <s>    light or dark, for a page that follows the system theme (default light)`

export interface RecordArgs {
  /** A page that calls expose(); empty with `file`. */
  url: string
  /** A .loadmap definition to draw instead of a page. */
  file?: string
  out: string
  script?: { at: number; scenario?: string; set?: Record<string, string | number | boolean> }[]
  scenario?: string
  set: Record<string, string | number | boolean>
  caption: boolean
  poster: boolean
  story: boolean
  seconds?: number
  fps?: number
  scale?: number
  seed?: number
  name: string
  width: number
  colorScheme: 'light' | 'dark'
}

/** Runs the command line; resolves to the exit code. */
export async function main(argv: string[], log: (s: string) => void = console.log): Promise<number> {
  const [command, ...rest] = argv
  if (command === 'check') return check(rest, { log })
  if (command !== 'record') {
    log(USAGE)
    return command === '--help' || command === '-h' ? 0 : 2
  }
  const args = await parseRecord(rest)
  const bytes = await record(args)
  await writeFile(args.out, bytes)
  log(`${args.out}: ${(bytes.length / 1024).toFixed(0)} KB`)
  return 0
}

export async function parseRecord(argv: string[]): Promise<RecordArgs> {
  const { values: v, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: 'string' },
      script: { type: 'string' },
      set: { type: 'string', multiple: true },
      scenario: { type: 'string' },
      caption: { type: 'boolean' },
      poster: { type: 'boolean' },
      story: { type: 'boolean' },
      seconds: { type: 'string' },
      fps: { type: 'string' },
      scale: { type: 'string' },
      seed: { type: 'string' },
      name: { type: 'string' },
      width: { type: 'string' },
      'color-scheme': { type: 'string' },
    },
  })
  const target = positionals[0]
  if (!target || !v.out) throw new Error(`loadmap record needs a URL or a .loadmap file and --out\n\n${USAGE}`)
  // a URL is a page, whatever its path ends in
  const file =
    !/^[a-z][a-z\d+.-]*:\/\//i.test(target) && extname(target).toLowerCase() === '.loadmap' ? target : undefined
  const num = (x: string | undefined, name: string) => {
    if (x == null) return undefined
    const n = Number(x)
    if (!x.trim() || !Number.isFinite(n) || n <= 0) throw new Error(`--${name} takes a positive number, not "${x}"`)
    return n
  }
  let script: RecordArgs['script']
  let fromFile: { seconds?: number; fps?: number } = {}
  if (v.script) {
    const parsed = JSON.parse(await readFile(v.script, 'utf8'))
    script = Array.isArray(parsed) ? parsed : parsed.script
    fromFile = Array.isArray(parsed) ? {} : parsed
  }
  const set: Record<string, string | number | boolean> = {}
  for (const kv of v.set ?? []) {
    const i = kv.indexOf('=')
    if (i < 1) throw new Error(`--set takes key=value, not "${kv}"`)
    const raw = kv.slice(i + 1).trim()
    if (!raw) throw new Error(`--set ${kv.slice(0, i)}= has no value`)
    const n = Number(raw)
    set[kv.slice(0, i)] = raw === 'true' ? true : raw === 'false' ? false : Number.isFinite(n) ? n : raw
  }
  const scheme = v['color-scheme'] ?? 'light'
  if (scheme !== 'light' && scheme !== 'dark') throw new Error('--color-scheme is light or dark')
  if (v.poster && extname(v.out).toLowerCase() !== '.png')
    throw new Error('--poster writes a PNG: --out must end in .png')
  if (v.story && !['.gif', '.webm', '.mp4'].includes(extname(v.out).toLowerCase()))
    throw new Error('--story plays a GIF or a video: --out must end in .gif, .webm or .mp4')
  if (v.story && (v.script || v.seconds || v.scenario || v.set))
    throw new Error(
      '--story sets the values and the length itself: leave out --script, --seconds, --scenario and --set',
    )
  return {
    url: file ? '' : target,
    ...(file ? { file } : {}),
    out: v.out,
    script,
    scenario: v.scenario,
    set,
    caption: v.caption ?? false,
    poster: v.poster ?? false,
    story: v.story ?? false,
    seconds: num(v.seconds, 'seconds') ?? fromFile.seconds,
    fps: num(v.fps, 'fps') ?? fromFile.fps,
    scale: num(v.scale, 'scale'),
    seed: num(v.seed, 'seed'),
    name: v.name ?? 'default',
    width: num(v.width, 'width') ?? 1280,
    colorScheme: scheme,
  }
}

/**
 * Records in a fresh headless Chromium and returns the file's bytes. A .loadmap file is compiled here first (its
 * errors are thrown, formatted), then drawn by the viewer in `o.viewer`: by default the one the build puts in
 * dist/viewer.
 */
export async function record(a: RecordArgs, o: { viewer?: string } = {}): Promise<Buffer> {
  const format = extname(a.out).slice(1).toLowerCase()
  if (!['gif', 'webm', 'mp4', 'png', 'svg'].includes(format))
    throw new Error(`--out must end in .gif, .webm, .mp4, .png or .svg`)
  if (!a.file) return recordPage(a, format)
  const source = await readFile(a.file, 'utf8')
  const r = compile(source)
  if (!r.ok) throw new Error(r.diagnostics.map((d) => formatDiagnostic(d, source, a.file)).join('\n'))
  const server = await serve(source, o.viewer ?? join(import.meta.dirname, '../dist/viewer'))
  try {
    return await recordPage({ ...a, url: server.url }, format)
  } finally {
    await server.close()
  }
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.loadmap': 'text/plain; charset=utf-8',
}

/** The viewer and the definition, on a port of 127.0.0.1 for as long as the recording takes. */
async function serve(source: string, dir: string): Promise<{ url: string; close: () => Promise<void> }> {
  try {
    await readFile(join(dir, 'index.html'))
  } catch {
    throw new Error(`no viewer in ${dir}: build the CLI first (pnpm --filter @loadmap/cli build)`)
  }
  const server = createServer(async (req, res) => {
    try {
      const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)).replace(/^[/\\]+/, '')
      if (path.split(/[/\\]/).includes('..')) throw new Error('outside the viewer')
      const file = path || 'index.html'
      const body = file === 'definition.loadmap' ? Buffer.from(source) : await readFile(join(dir, file))
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
      res.end(body)
    } catch {
      res.writeHead(404).end()
    }
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}/`, close: () => new Promise((done) => server.close(() => done())) }
}

async function recordPage(a: RecordArgs, format: string): Promise<Buffer> {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: a.width, height: 900 }, colorScheme: a.colorScheme })
    await page.goto(a.url)
    await page
      .waitForFunction(
        (name) => Boolean((globalThis as { __loadmap?: Record<string, unknown> }).__loadmap?.[name]),
        a.name,
        { timeout: 30_000 },
      )
      .catch(() => {
        throw new Error(
          `no loadmap "${a.name}" on ${a.url}: the page must call expose(handle${a.name === 'default' ? '' : `, '${a.name}'`})`,
        )
      })
    const out = await page.evaluate(
      async ({ a, format }) => {
        const r = (globalThis as { __loadmap?: Record<string, PageRecorder> }).__loadmap![a.name]!
        const still = { scenario: a.scenario, set: a.set, scale: a.scale, seed: a.seed, caption: a.caption }
        if (format === 'svg') return r.svg(still)
        if (format === 'png') return a.poster ? r.poster(still) : r.still(still)
        if (a.story)
          return r.record({
            format: format as 'gif',
            story: true,
            fps: a.fps,
            scale: a.scale,
            seed: a.seed,
            caption: a.caption,
          })
        const script = [{ at: 0, scenario: a.scenario, set: a.set }, ...(a.script ?? [])]
        return r.record({
          format: format as 'gif',
          seconds: a.seconds ?? 8,
          fps: a.fps,
          scale: a.scale,
          seed: a.seed,
          caption: a.caption,
          script,
        })
      },
      { a, format },
    )
    return format === 'svg' ? Buffer.from(out, 'utf8') : Buffer.from(out, 'base64')
  } finally {
    await browser.close()
  }
}
