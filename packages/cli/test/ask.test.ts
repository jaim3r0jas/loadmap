import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { recorded } from '@loadmap/dsl/assist'
import { describe, expect, it } from 'vitest'
import { ask } from '../src/ask'

const shop = await readFile(new URL('../../../examples/shop-live/shop.loadmap', import.meta.url), 'utf8')

async function folder() {
  const dir = await mkdtemp(join(tmpdir(), 'loadmap-ask-'))
  await writeFile(join(dir, 'shop.loadmap'), shop)
  await writeFile(join(dir, 'ref.md'), '# loadmap\nThe reference.')
  return dir
}

async function run(argv: string[], answers: string[], dir: string) {
  const lines: string[] = []
  const model = recorded(answers)
  const code = await ask(argv, { log: (s) => lines.push(s), write: () => {}, model, cwd: dir, env: {} })
  return { code, out: lines.join('\n'), model }
}

describe('loadmap ask', () => {
  const add = '```ops\nput\n  scenario "Eight" { pods: 8 }\n```'

  it('shows the change as a diff and writes nothing without --write', async () => {
    const dir = await folder()
    const r = await run(['shop.loadmap', 'add', 'a', 'scenario', '--reference', 'ref.md'], [add], dir)
    expect(r.code).toBe(0)
    expect(r.out).toContain('Added scenario Eight')
    expect(r.out).toContain('+scenario "Eight" { pods: 8 }')
    expect(r.out).toContain('Nothing written')
    expect(await readFile(join(dir, 'shop.loadmap'), 'utf8')).toBe(shop)
    expect(r.model.requests[0]!.system).toContain('The reference.')
  })

  it('writes the change with --write, and sends the selected box', async () => {
    const dir = await folder()
    const r = await run(
      ['shop.loadmap', 'more pods', '--box', 'orderWorkers', '--write', '--reference', 'ref.md'],
      [add],
      dir,
    )
    expect(r.code).toBe(0)
    expect(await readFile(join(dir, 'shop.loadmap'), 'utf8')).toContain('scenario "Eight" { pods: 8 }')
    expect(r.model.requests[0]!.context).toContain('The box orderWorkers')
  })

  it('exits 1 when every answer was refused, and 2 without a model or a request', async () => {
    const dir = await folder()
    const bad = '```ops\nremove nothing\n```'
    expect((await run(['shop.loadmap', 'x', '--reference', 'ref.md'], [bad, bad, bad], dir)).code).toBe(1)
    expect((await run(['shop.loadmap'], [], dir)).code).toBe(2)
    const lines: string[] = []
    expect(
      await ask(['shop.loadmap', 'x'], {
        log: (s) => lines.push(s),
        cwd: dir,
        env: { LOADMAP_AI_PROVIDER: 'deepseek' },
      }),
    ).toBe(2)
    expect(lines.join('\n')).toContain('set DEEPSEEK_API_KEY or LOADMAP_AI_KEY')
  })
})
