import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ALL_FORMATS, BufferSource, Input } from 'mediabunny'
import { build, createServer, type ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { check, fmt, main, parseRecord, record } from '../src'
import { playwright } from '../src/playwright'

const checkout = join(import.meta.dirname, '../../../examples/checkout/checkout.loadmap')

describe('arguments', () => {
  it('reads values, numbers and a script file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loadmap-cli-'))
    const script = join(dir, 's.json')
    await writeFile(script, JSON.stringify({ seconds: 6, fps: 12, script: [{ at: 2, set: { load: 40 } }] }))
    const a = await parseRecord([
      'http://x/',
      '--out',
      'a.gif',
      '--set',
      'load=30',
      '--set',
      'batch=false',
      '--script',
      script,
    ])
    expect(a).toMatchObject({ url: 'http://x/', out: 'a.gif', set: { load: 30, batch: false }, seconds: 6, fps: 12 })
    expect(a.script).toEqual([{ at: 2, set: { load: 40 } }])
    await rm(dir, { recursive: true })
  })

  it('reads a scenario, a caption and a poster', async () => {
    const a = await parseRecord(['http://x/', '--out', 'p.png', '--scenario', 'Proposed', '--caption', '--poster'])
    expect(a).toMatchObject({ scenario: 'Proposed', caption: true, poster: true })
    await expect(parseRecord(['http://x/', '--out', 'p.gif', '--poster'])).rejects.toThrow(/--poster writes a PNG/)
  })

  it('refuses numbers that would write a broken file', async () => {
    await expect(parseRecord(['http://x/', '--out', 'a.gif', '--seconds', '8s'])).rejects.toThrow(
      /--seconds takes a positive number/,
    )
    await expect(parseRecord(['http://x/', '--out', 'a.gif', '--fps', '0'])).rejects.toThrow(/--fps/)
    await expect(parseRecord(['http://x/', '--out', 'a.gif', '--set', 'load='])).rejects.toThrow(/has no value/)
  })

  it('explains itself without a command, and asks for --out', async () => {
    const out: string[] = []
    expect(await main([], (s) => out.push(s))).toBe(2)
    expect(out[0]).toContain('loadmap record <url | file.loadmap> --out')
    await expect(parseRecord(['http://x/'])).rejects.toThrow(/needs a URL or a .loadmap file and --out/)
  })

  it('takes a .loadmap file in place of a URL', async () => {
    expect(await parseRecord(['m.loadmap', '--out', 'a.gif'])).toMatchObject({ url: '', file: 'm.loadmap' })
    expect(await parseRecord(['http://x/m.loadmap.html', '--out', 'a.gif'])).not.toHaveProperty('file')
    // a URL is a page, whatever its path ends in
    for (const url of ['https://host/m.loadmap', 'http://localhost:5173/?file=a.loadmap'])
      expect(await parseRecord([url, '--out', 'a.gif'])).toMatchObject({ url })
  })
})

describe('Playwright', () => {
  it('is loaded only to record, and its absence says how to install it', async () => {
    const missing = Object.assign(new Error("Cannot find package 'playwright'"), { code: 'ERR_MODULE_NOT_FOUND' })
    await expect(playwright(() => Promise.reject(missing))).rejects.toThrow(
      'loadmap record needs Playwright: npm i -D playwright, then npx playwright install chromium',
    )
    // a Playwright that is there but broken says so itself
    await expect(playwright(() => Promise.reject(new Error('broken')))).rejects.toThrow('broken')
    expect(await playwright()).toHaveProperty('chromium')
  })

  it('is never imported at the top of a module, so check and fmt run without it', async () => {
    const src = join(import.meta.dirname, '../src')
    for (const f of await readdir(src))
      expect(await readFile(join(src, f), 'utf8'), f).not.toMatch(/^import [^\n]*from ['"]playwright['"]/m)
  })
})

describe('recording the docs site', () => {
  let server: ViteDevServer
  let url: string
  let dir: string

  beforeAll(async () => {
    server = await createServer({
      configFile: join(import.meta.dirname, '../../../apps/docs/vite.config.ts'),
      server: { port: 0, host: '127.0.0.1' },
      logLevel: 'error',
    })
    await server.listen()
    url = server.resolvedUrls!.local[0]!
    dir = await mkdtemp(join(tmpdir(), 'loadmap-cli-'))
  }, 60_000)

  afterAll(async () => {
    await server?.close()
    if (dir) await rm(dir, { recursive: true })
  })

  const args = (out: string, extra: string[] = []) =>
    parseRecord([
      `${url}examples/checkout/`,
      '--out',
      join(dir, out),
      '--seconds',
      '1',
      '--fps',
      '8',
      '--scale',
      '0.5',
      ...extra,
    ])

  it('makes the same GIF twice', async () => {
    const a = await record(await args('a.gif', ['--set', 'load=30']))
    const b = await record(await args('b.gif', ['--set', 'load=30']))
    expect(a.subarray(0, 6).toString('latin1')).toBe('GIF89a')
    expect(a.equals(b)).toBe(true)
    // the frame delays (graphic control extensions, in hundredths) add up to the second asked for
    let cs = 0
    for (let i = 0; i < a.length - 5; i++)
      if (a[i] === 0x21 && a[i + 1] === 0xf9 && a[i + 2] === 4) cs += a.readUInt16LE(i + 4)
    expect(cs).toBe(100)
  }, 120_000)

  for (const format of ['webm', 'mp4'] as const)
    it(`makes a ${format} of the requested length`, async () => {
      const bytes = await record(await args(`v.${format}`))
      const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS })
      expect(await input.computeDuration()).toBeCloseTo(1, 0)
      expect(await input.getPrimaryVideoTrack()).toBeTruthy()
    }, 120_000)

  it('writes a PNG through the command line', async () => {
    const out: string[] = []
    const png = join(dir, 'still.png')
    expect(await main(['record', `${url}examples/alerts/`, '--out', png, '--set', 'load=30'], (s) => out.push(s))).toBe(
      0,
    )
    expect((await readFile(png)).subarray(1, 4).toString('latin1')).toBe('PNG')
    expect(out[0]).toMatch(/still\.png: \d+ KB/)
  }, 120_000)

  it('makes the same captioned GIF of a scenario twice', async () => {
    const extra = ['--scenario', 'Proposed', '--caption', '--set', 'load=30']
    const a = await record(await args('c1.gif', extra))
    const b = await record(await args('c2.gif', extra))
    expect(a.equals(b)).toBe(true)
    // the caption adds its bands: taller than the board alone
    const plain = await record(await args('c3.gif', ['--scenario', 'Proposed', '--set', 'load=30']))
    expect(a.readUInt16LE(8)).toBeGreaterThan(plain.readUInt16LE(8))
  }, 120_000)

  it('writes a poster and an SVG', async () => {
    const poster = await record(await args('p.png', ['--poster', '--scenario', 'Proposed']))
    expect(poster.subarray(1, 4).toString('latin1')).toBe('PNG')
    const svg = (await record(await args('b.svg', ['--caption']))).toString('utf8')
    expect(svg).toMatch(/^<svg [^>]*xmlns="http:\/\/www.w3.org\/2000\/svg"/)
    expect(svg).toContain('Checkout pipeline')
    await expect(record(await args('x.gif', ['--scenario', 'Later']))).rejects.toThrow(
      /no scenario "Later"; the model has "Today", "Proposed"/,
    )
  }, 120_000)

  it('names the missing expose() call', async () => {
    await expect(record(await args('x.gif', ['--name', 'nope']))).rejects.toThrow(/must call expose\(handle, 'nope'\)/)
  }, 60_000)
})

describe('loadmap check', () => {
  let dir: string
  let failing: string
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'loadmap-check-'))
    failing = join(dir, 'checkout.loadmap')
    // the same definition, promising 8× today: the pessimistic edge is 7.4×
    const src = (await readFile(checkout, 'utf8')).replace('{ target: 7 }', '{ target: 8 }')
    await writeFile(failing, src)
  })
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true })
  })

  const run = async (argv: string[], env: Record<string, string> = {}) => {
    const out: string[] = []
    const code = await check(argv, { log: (s) => out.push(s), env })
    return { code, out: out.join('\n') }
  }

  it('passes checkout, whose expectations hold', async () => {
    const { code, out } = await run([checkout])
    expect(code).toBe(0)
    expect(out).toContain('checkout.loadmap: 2 expectations hold')
    expect(out).toContain('  ✓ Today keeps 7×: the 50 % target holds up to between 7.4× and 10×')
  })

  it('exits 1 on a failing expectation, with its line and column', async () => {
    const { code, out } = await run([failing])
    expect(code).toBe(1)
    const line = (await readFile(failing, 'utf8')).split('\n').findIndex((l) => l.startsWith('expect "Today')) + 1
    expect(out).toContain(
      `${failing}:${line}:1 error: "Today keeps 7×" fails: expected at least 8×, but the 50 % target holds up to between 7.4× and 10×`,
    )
    expect(out).toContain(`${line} | expect "Today keeps 7×" { target: 8 }`)
    expect(out).toContain('checkout.loadmap: 1 of 2 expectations failed')
    // the command line gives the same code
    expect(await main(['check', failing], () => {})).toBe(1)
  })

  it('annotates the line for GitHub, by flag or under GitHub Actions', async () => {
    const line = (await readFile(failing, 'utf8')).split('\n').findIndex((l) => l.startsWith('expect "Today')) + 1
    const file = failing.replaceAll(':', '%3A').replaceAll(',', '%2C')
    const annotation = `::error file=${file},line=${line},col=1,endLine=${line},endColumn=24,title=loadmap check::"Today keeps 7×" fails: expected at least 8×, but the 50 %25 target holds up to`
    expect((await run(['--format', 'github', failing])).out).toContain(annotation)
    expect((await run([failing], { GITHUB_ACTIONS: 'true' })).out).toContain(annotation)
    expect((await run([failing])).out).not.toContain('::error')
  })

  it('fails on a definition with an error or a missing file, and explains its usage', async () => {
    const broken = join(dir, 'broken.loadmap')
    await writeFile(broken, 'loadmap 1\nload { max: 3 }\n')
    const b = await run([broken, checkout])
    expect(b.code).toBe(1)
    expect(b.out).toContain(`${broken}:1:1 error: a definition needs at least one flow`)
    expect(b.out).toContain('broken.loadmap: does not compile (1 error)')
    expect(b.out).toContain('checkout.loadmap: 2 expectations hold')
    expect((await run([join(dir, 'nope.loadmap')])).out).toMatch(/nope\.loadmap: cannot read it \(ENOENT\)/)
    expect(await run([])).toMatchObject({ code: 2, out: 'loadmap check needs one or more .loadmap files' })
    expect((await run(['--format', 'xml', checkout])).code).toBe(2)
  })
})

describe('loadmap fmt', () => {
  let dir: string
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'loadmap-fmt-'))
  })
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true })
  })

  const messy =
    'loadmap 1\nload {max: 3}\nflow a { rate:2*load; route: b; from: c }\nnode c\nnode b {\npass\n  capacity:measured(9 ,"req/s")\n}\n'
  const tidy =
    'loadmap 1\nload { max: 3 }\nflow a { rate: 2 * load; route: b; from: c }\nnode c\nnode b {\n  pass\n  capacity: measured(9, "req/s")\n}\n'
  const run = async (argv: string[], input = '') => {
    const out: string[] = []
    let written = ''
    const code = await fmt(argv, { log: (s) => out.push(s), read: async () => input, write: (s) => (written += s) })
    return { code, out: out.join('\n'), written }
  }

  it('rewrites a file in place and leaves a laid out one alone', async () => {
    const a = join(dir, 'a.loadmap')
    const b = join(dir, 'b.loadmap')
    await writeFile(a, messy)
    await writeFile(b, tidy)
    const r = await run([a, b])
    expect(r).toMatchObject({ code: 0, out: `${a}: formatted\n1 of 2 files formatted` })
    expect(await readFile(a, 'utf8')).toBe(tidy)
    expect(await readFile(b, 'utf8')).toBe(tidy)
    expect(await main(['fmt', a, b], () => {})).toBe(0)
  })

  it('with --check, only names what needs formatting', async () => {
    const a = join(dir, 'check.loadmap')
    await writeFile(a, messy)
    const r = await run(['--check', a, checkout])
    expect(r).toMatchObject({ code: 1, out: `${a}: not laid out by loadmap fmt\n1 of 2 files need loadmap fmt` })
    expect(await readFile(a, 'utf8')).toBe(messy)
    expect(await run(['--check', checkout])).toMatchObject({ code: 0, out: '1 file laid out already' })
  })

  it('leaves a file with a syntax error alone, and says where', async () => {
    const a = join(dir, 'broken.loadmap')
    const src = 'loadmap 1\nload { max: }\n'
    await writeFile(a, src)
    const r = await run([a])
    expect(r.code).toBe(1)
    expect(r.out).toContain(`${a}:2:13 error: "max" has no value`)
    expect(r.out).toContain(`${a}: left as it is, it has a syntax error`)
    expect(r.out).toContain('0 of 1 file formatted; 1 left out (unreadable or a syntax error)')
    expect((await run(['--check', a, checkout])).out).toContain(
      '1 of 2 files laid out already; 1 left out (unreadable or a syntax error)',
    )
    expect(await readFile(a, 'utf8')).toBe(src)
    expect((await run([join(dir, 'nope.loadmap')])).out).toMatch(/nope\.loadmap: cannot read it \(ENOENT\)/)
  })

  it('reads standard input and writes standard output', async () => {
    expect(await run(['-'], messy)).toMatchObject({ code: 0, written: tidy, out: '' })
    const bad = await run(['-'], 'load { max: }')
    expect(bad).toMatchObject({ code: 1, written: '' })
    expect(bad.out).toContain('<stdin>:1:13 error')
  })

  it('explains its usage', async () => {
    expect(await run([])).toMatchObject({
      code: 2,
      out: 'loadmap fmt needs one or more .loadmap files, or - for standard input',
    })
    expect((await run(['-', checkout])).code).toBe(2)
    expect((await run(['--check', '-'])).code).toBe(2)
  })
})

/** The frames of a GIF: one graphic control extension (21 F9 04) each. */
function frames(gif: Buffer): number {
  const mark = Buffer.from([0x21, 0xf9, 0x04])
  let n = 0
  for (let i = gif.indexOf(mark); i >= 0; i = gif.indexOf(mark, i + 1)) n++
  return n
}

describe('recording a .loadmap', () => {
  let viewer: string
  let dir: string
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'loadmap-viewer-'))
    viewer = join(dir, 'viewer')
    await build({
      configFile: join(import.meta.dirname, '../viewer/vite.config.ts'),
      build: { outDir: viewer, emptyOutDir: true },
      logLevel: 'error',
    })
  }, 120_000)
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true })
  })

  const args = (out: string, extra: string[] = []) =>
    parseRecord([checkout, '--out', join(dir, out), '--seconds', '1', '--fps', '8', '--scale', '0.5', ...extra])

  it('makes the same GIF twice', async () => {
    const a = await record(await args('a.gif', ['--set', 'load=30']), { viewer })
    const b = await record(await args('b.gif', ['--set', 'load=30']), { viewer })
    expect(a.subarray(0, 6).toString('latin1')).toBe('GIF89a')
    expect(a.equals(b)).toBe(true)
    // the definition is what is drawn: its title is in the SVG
    const svg = (await record(await args('b.svg', ['--caption']), { viewer })).toString('utf8')
    expect(svg).toContain('Checkout pipeline')
  }, 120_000)

  it('records a story the same twice', async () => {
    const story = (out: string) =>
      parseRecord([checkout, '--out', join(dir, out), '--story', '--caption', '--fps', '2', '--scale', '0.5'])
    const a = await record(await story('s1.gif'), { viewer })
    const b = await record(await story('s2.gif'), { viewer })
    expect(a.subarray(0, 6).toString('latin1')).toBe('GIF89a')
    expect(a.equals(b)).toBe(true)
    // played as the page plays it: the whole diagram 1.2 s, then each of the three steps a flight in (1 s), a moment
    // close (0.5 s), the change held close (1.6 s), a flight out (1 s) and its 4 s: 25.5 s at 2 frames a second
    expect(frames(a)).toBe(51)
  }, 120_000)

  it('refuses --story with values of its own or a still', async () => {
    await expect(parseRecord([checkout, '--out', 'x.png', '--story'])).rejects.toThrow('--story plays a GIF or a video')
    await expect(parseRecord([checkout, '--out', 'x.gif', '--story', '--set', 'load=3'])).rejects.toThrow(
      '--story sets the values and the length itself',
    )
  })

  it('stops on a definition with an error, before opening a browser', async () => {
    const broken = join(dir, 'broken.loadmap')
    await writeFile(broken, 'loadmap 1\nload { max: 3 }\n')
    await expect(record(await parseRecord([broken, '--out', join(dir, 'x.gif')]), { viewer })).rejects.toThrow(
      `${broken}:1:1 error: a definition needs at least one flow`,
    )
    await expect(record(await args('y.gif'), { viewer: join(dir, 'none') })).rejects.toThrow(/no viewer in/)
  })
})
