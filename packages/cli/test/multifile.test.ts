import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bundle } from '../src/bundle'
import { type CheckedFile, check } from '../src/check'
import { fmt } from '../src/fmt'
import { project } from '../src/project'

const docs = (f: string) => readFile(new URL(`../../../docs/multi-file/${f}`, import.meta.url), 'utf8')
const NAMES = ['shop.loadmap', 'shop.story.loadmap', 'platform.loadmap', 'shop.big.loadmap']

/** The docs' multi-file example in a folder of its own, some files changed. */
async function shop(changes: Record<string, (text: string) => string> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'loadmap-files-'))
  await mkdir(join(dir, 'models'))
  for (const f of NAMES) await writeFile(join(dir, 'models', f), (changes[f] ?? ((t) => t))(await docs(f)))
  return { dir, at: (f: string) => join(dir, 'models', f) }
}

async function run(command: (argv: string[], o: { log: (s: string) => void }) => Promise<number>, argv: string[]) {
  const lines: string[] = []
  const code = await command(argv, { log: (s) => lines.push(s) })
  return { code, out: lines.join('\n') }
}

describe('the cli on a definition in several files', () => {
  it('checks a model with its files, a part through its model once, and a library alone', async () => {
    const { at } = await shop()
    const model = await run(check, [at('shop.loadmap')])
    expect(model).toMatchObject({ code: 0 })
    expect(model.out).toContain('1 expectation holds')
    // the part with its model: the model is checked, once
    const both = await run(check, [at('shop.loadmap'), at('shop.story.loadmap')])
    expect(both.code).toBe(0)
    expect(both.out.match(/expectation holds/g)).toHaveLength(1)
    // a variant is a definition of its own: checked beside its model, not left to it
    const withVariant = await run(check, [at('shop.loadmap'), at('shop.big.loadmap')])
    expect(withVariant.out.match(/expectation holds/g)).toHaveLength(2)
    // the part alone is read through its model; a variant and a library as themselves
    for (const f of ['shop.story.loadmap', 'shop.big.loadmap', 'platform.loadmap'])
      expect((await run(check, [at(f)])).code, f).toBe(0)
  })

  it('says a problem in the file it is in, in the text and in the JSON', async () => {
    const { at } = await shop({
      'shop.story.loadmap': (t) => t.replace('focus: orderLine.consumers }', 'focus: nowhere }'),
    })
    const text = await run(check, [at('shop.loadmap')])
    expect(text.code).toBe(1)
    expect(text.out).toMatch(/shop\.story\.loadmap:6:\d+ error\[unknown-name\]/)
    expect(text.out).toContain('focus: nowhere')
    const json = await run(check, [at('shop.loadmap'), '--format', 'json'])
    const [file] = (JSON.parse(json.out) as { files: CheckedFile[] }).files
    expect(file!.outcome).toBe('error')
    expect(file!.diagnostics).toHaveLength(1)
    expect(file!.diagnostics[0]).toMatchObject({ code: 'unknown-name', line: 6 })
    expect(file!.diagnostics[0]!.file).toMatch(/shop\.story\.loadmap$/)
  })

  it('reads nothing outside the project, whatever a path says', async () => {
    const { dir, at } = await shop({
      'shop.loadmap': (t) => t.replace('"./platform.loadmap"', '"../../platform.loadmap"'),
    })
    // the file is there, outside the folder the model is in: it is not read
    await writeFile(join(dir, '..', 'platform.loadmap'), await docs('platform.loadmap')).catch(() => {})
    const p = project(at('shop.loadmap'), dir)
    expect(p.root).toBe(dir)
    expect(p.path).toBe('models/shop.loadmap')
    expect(p.files('models/platform.loadmap')).toContain('library "Platform building blocks"')
    expect(p.files('../platform.loadmap')).toBeUndefined()
    expect(p.files('models/shop.txt')).toBeUndefined()
    const r = await run(check, [at('shop.loadmap')])
    expect(r.code).toBe(1)
    expect(r.out).toContain('missing-file')
  })

  it('bundles a model into one file that checks the same', async () => {
    const { dir, at } = await shop()
    const out = join(dir, 'flat.loadmap')
    expect(await run(bundle, [at('shop.loadmap'), '--out', out])).toMatchObject({ code: 0 })
    const flat = await readFile(out, 'utf8')
    expect(flat).toContain('pool orderLine.consumers')
    expect(flat).not.toContain('import ')
    const checked = await run(check, [out])
    expect(checked.code).toBe(0)
    expect(checked.out).toContain('1 expectation holds')
    // a model that does not compile has no flat copy
    const broken = await shop({ 'shop.loadmap': (t) => t.replace('rate: 40 * load', 'rate: 40 * lod') })
    expect((await run(bundle, [broken.at('shop.loadmap')])).code).toBe(1)
    expect((await run(bundle, [])).code).toBe(2)
  })

  it('sets the parts of a model to its version', async () => {
    const { at } = await shop({ 'shop.story.loadmap': (t) => t.replace('loadmap 1.4', 'loadmap 1.2') })
    const only = await run(fmt, [at('shop.loadmap'), '--check'])
    expect(only.code).toBe(1)
    expect(only.out).toContain('says loadmap 1.2')
    const done = await run(fmt, [at('shop.loadmap')])
    expect(done.code).toBe(0)
    expect((await readFile(at('shop.story.loadmap'), 'utf8')).split('\n')[0]).toBe('loadmap 1.4')
    expect((await run(fmt, [at('shop.loadmap'), '--check'])).code).toBe(0)
  })
})
