import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compile, decodeShare, encodeShare, sharedValues } from '../src'

const checkout = readFileSync(join(import.meta.dirname, '../../../examples/checkout/checkout.loadmap'), 'utf8')

describe('values in a shared link', () => {
  const source = checkout.replace(
    'param batch "Batch DB writes" { default: true }',
    'param batch "Batch DB writes" { default: true }\nparam tier "Tier" { options: ["10", "20"]; default: "10" }',
  )
  const model = compile(source).definition!.model

  it("are read by each parameter's kind: an option, a switch, a number in its range", async () => {
    const shared = await decodeShare(await encodeShare(source, { tier: '20', pods: 6, batch: false, load: 30 }))
    if ('error' in shared) throw new Error(shared.error)
    expect(shared.values).toEqual({ tier: '20', pods: '6', batch: 'false', load: '30' })
    expect(sharedValues(model, shared.values)).toEqual({ tier: '20', pods: 6, batch: false, load: 30 })
  })

  it('keep only what still fits the model', () => {
    expect(sharedValues(model, { pods: '5', load: '500', batch: 'maybe', gone: '1', constructor: 'x' })).toEqual({
      load: 100,
    })
  })
})
