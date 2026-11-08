import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { launch } from '../src/launch'

const ext = join('/', 'ext')
const ws = join('/', 'work', 'shop')
const bundled = { module: join(ext, 'dist', 'server.cjs') }

describe('which server the client starts', () => {
  it('the bundled one when no path is set', () => {
    expect(launch(undefined, ext, ws, true)).toEqual(bundled)
    expect(launch('  ', ext, ws, true)).toEqual(bundled)
  })

  it("a project's own command, from the workspace folder", () => {
    expect(launch('node_modules/.bin/loadmap', ext, ws, true)).toEqual({
      command: join(ws, 'node_modules/.bin/loadmap'),
      args: ['lsp'],
      cwd: ws,
    })
  })

  it('an absolute path as it is, a bare name from the PATH', () => {
    const abs = join('/', 'opt', 'loadmap')
    expect(launch(abs, ext, ws, true)).toEqual({ command: abs, args: ['lsp'], cwd: ws })
    expect(launch('loadmap', ext, ws, true)).toEqual({ command: 'loadmap', args: ['lsp'], cwd: ws })
    expect(launch('loadmap', ext, undefined, true)).toEqual({ command: 'loadmap', args: ['lsp'] })
  })

  it('never a command in a workspace nobody trusted, whoever set the path', () => {
    for (const path of ['node_modules/.bin/loadmap', 'loadmap', join('/', 'opt', 'loadmap')])
      expect(launch(path, ext, ws, false)).toEqual(bundled)
  })
})
