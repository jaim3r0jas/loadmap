import { readFile, writeFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { parseArgs } from 'node:util'
import type { PageRecorder } from '@loadmap/export'
import { chromium } from 'playwright'

export const USAGE = `loadmap record <url> --out <file.gif|.webm|.mp4|.png|.svg> [options]

Opens the page in headless Chromium, finds the loadmap it exposes (expose() from @loadmap/export) and records it
on a fixed clock, so the same options give the same file.

  --out <file>          the extension picks the format: gif, webm, mp4, png or svg
  --script <file.json>  [{ "at": 0, "set": { "load": 5 } }, { "at": 3, "scenario": "Proposed" }, …]
                        or { "seconds", "fps", "script": […] }
  --scenario <label>    start from a scenario's values (--set goes on top)
  --set <key=value>     a value before recording starts; repeatable (--set load=30 --set pods=6)
  --caption             the title, scenario and load above the board, the verdict below it
  --poster              with .png: the board, the verdict, the limits and the scenarios compared
  --seconds <n>         length of a video or GIF (default 8, or the script's)
  --fps <n>             frames per second (default 30; GIF 15, at most 50)
  --scale <n>           pixels per diagram unit (default 1, PNG 2)
  --seed <n>            the sim's seed (default 1)
  --name <name>         which exposed loadmap, when the page has several (default "default")
  --width <px>          the browser window (default 1280; below 640 the diagram runs top to bottom)
  --color-scheme <s>    light or dark, for a page that follows the system theme (default light)`

export interface RecordArgs {
  url: string
  out: string
  script?: { at: number; scenario?: string; set?: Record<string, string | number | boolean> }[]
  scenario?: string
  set: Record<string, string | number | boolean>
  caption: boolean
  poster: boolean
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
      seconds: { type: 'string' },
      fps: { type: 'string' },
      scale: { type: 'string' },
      seed: { type: 'string' },
      name: { type: 'string' },
      width: { type: 'string' },
      'color-scheme': { type: 'string' },
    },
  })
  const url = positionals[0]
  if (!url || !v.out) throw new Error(`loadmap record needs a URL and --out\n\n${USAGE}`)
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
  return {
    url,
    out: v.out,
    script,
    scenario: v.scenario,
    set,
    caption: v.caption ?? false,
    poster: v.poster ?? false,
    seconds: num(v.seconds, 'seconds') ?? fromFile.seconds,
    fps: num(v.fps, 'fps') ?? fromFile.fps,
    scale: num(v.scale, 'scale'),
    seed: num(v.seed, 'seed'),
    name: v.name ?? 'default',
    width: num(v.width, 'width') ?? 1280,
    colorScheme: scheme,
  }
}

/** Records in a fresh headless Chromium and returns the file's bytes. */
export async function record(a: RecordArgs): Promise<Buffer> {
  const format = extname(a.out).slice(1).toLowerCase()
  if (!['gif', 'webm', 'mp4', 'png', 'svg'].includes(format))
    throw new Error(`--out must end in .gif, .webm, .mp4, .png or .svg`)
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
