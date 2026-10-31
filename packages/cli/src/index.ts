import { readFile, writeFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { parseArgs } from 'node:util'
import type { PageRecorder } from '@loadmap/export'
import { chromium } from 'playwright'

export const USAGE = `loadmap record <url> --out <file.gif|.webm|.mp4|.png> [options]

Opens the page in headless Chromium, finds the loadmap it exposes (expose() from @loadmap/export) and records it
on a fixed clock, so the same options give the same file.

  --out <file>          the extension picks the format: gif, webm, mp4 or png
  --script <file.json>  [{ "at": 0, "set": { "load": 5 } }, …] or { "seconds", "fps", "script": […] }
  --set <key=value>     a value before recording starts; repeatable (--set load=30 --set pods=6)
  --seconds <n>         length of a video or GIF (default 8, or the script's)
  --fps <n>             frames per second (default 30, GIF 15)
  --scale <n>           pixels per diagram unit (default 1, PNG 2)
  --seed <n>            the sim's seed (default 1)
  --name <name>         which exposed loadmap, when the page has several (default "default")
  --width <px>          the browser window (default 1280; below 640 the diagram runs top to bottom)
  --color-scheme <s>    light or dark, for a page that follows the system theme (default light)`

export interface RecordArgs {
  url: string
  out: string
  script?: { at: number; set: Record<string, string | number | boolean> }[]
  set: Record<string, string | number | boolean>
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
  const num = (x: string | undefined) => (x == null ? undefined : Number(x))
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
    const raw = kv.slice(i + 1)
    set[kv.slice(0, i)] =
      raw === 'true' ? true : raw === 'false' ? false : Number.isNaN(Number(raw)) ? raw : Number(raw)
  }
  const scheme = v['color-scheme'] ?? 'light'
  if (scheme !== 'light' && scheme !== 'dark') throw new Error('--color-scheme is light or dark')
  return {
    url,
    out: v.out,
    script,
    set,
    seconds: num(v.seconds) ?? fromFile.seconds,
    fps: num(v.fps) ?? fromFile.fps,
    scale: num(v.scale),
    seed: num(v.seed),
    name: v.name ?? 'default',
    width: num(v.width) ?? 1280,
    colorScheme: scheme,
  }
}

/** Records in a fresh headless Chromium and returns the file's bytes. */
export async function record(a: RecordArgs): Promise<Buffer> {
  const format = extname(a.out).slice(1).toLowerCase()
  if (!['gif', 'webm', 'mp4', 'png'].includes(format)) throw new Error(`--out must end in .gif, .webm, .mp4 or .png`)
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
    const b64 = await page.evaluate(
      async ({ a, format }) => {
        const r = (globalThis as { __loadmap?: Record<string, PageRecorder> }).__loadmap![a.name]!
        if (format === 'png') return r.still({ set: a.set, scale: a.scale, seed: a.seed })
        const script = [{ at: 0, set: a.set }, ...(a.script ?? [])]
        return r.record({
          format: format as 'gif',
          seconds: a.seconds ?? 8,
          fps: a.fps,
          scale: a.scale,
          seed: a.seed,
          script,
        })
      },
      { a, format },
    )
    return Buffer.from(b64, 'base64')
  } finally {
    await browser.close()
  }
}
