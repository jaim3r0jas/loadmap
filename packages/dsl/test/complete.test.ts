import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { completions, decodeShare, encodeShare, MAX_SHARED_BYTES } from '../src'

const checkout = readFileSync(new URL('../../../examples/checkout/checkout.loadmap', import.meta.url), 'utf8')
const alerts = readFileSync(new URL('../../../examples/alerts/alerts.loadmap', import.meta.url), 'utf8')

/** Completions where "|" is in `src`. */
function at(src: string) {
  const i = src.indexOf('|')
  const text = src.slice(0, i) + src.slice(i + 1)
  const c = completions(text, i)
  return { labels: c.options.map((o) => o.label), word: text.slice(c.from, c.to), c }
}

/** The checkout definition with `line` added inside the block that starts with `opener`. */
const inside = (opener: string, line: string) => checkout.replace(opener, `${opener}\n  ${line}`)

describe('completions', () => {
  it('offers the entries of a table after its dot', () => {
    expect(at(inside('flow orders "orders" {', 'rate: flows.ev|')).labels).toEqual(['orders', 'events'])
    expect(at(inside('flow orders "orders" {', 'rate: util.|')).labels).toEqual(['gateway', 'workers', 'db'])
    expect(at(inside('flow orders "orders" {', 'rate: at.|')).labels).toEqual(['gateway', 'topic', 'workers', 'db'])
    expect(at(inside('flow orders "orders" {', 'rate: at.db.o|')).labels).toEqual(['orders', 'events'])
  })

  it("offers a block's properties and statements at the start of a line", () => {
    const { labels, word, c } = at(inside('flow orders "orders" {', 'pri|'))
    expect(word).toBe('pri')
    expect(labels).toEqual(['unit', 'rate', 'priority', 'route', 'from', 'color', 'drop', 'merge', 'retry'])
    expect(c.options.find((o) => o.label === 'rate')).toMatchObject({ apply: 'rate: ', detail: 'required' })
  })

  it('offers stages in a route, nodes in an edge and after from', () => {
    const route = at(inside('flow orders "orders" {', 'route: gateway -> |')).labels
    expect(route).toEqual(['gateway', 'topic', 'workers', 'db', 'kafka'])
    expect(at(`${checkout}\nphones -> |`).labels).toEqual(['phones', 'gateway', 'kafka', 'workers', 'db'])
    expect(at(inside('flow orders "orders" {', 'from: |')).labels).toContain('phones')
  })

  it('offers the names a formula can read', () => {
    const { labels } = at(inside('flow orders "orders" {', 'rate: |'))
    expect(labels).toEqual(
      expect.arrayContaining(['load', 'pods', 'batch', 'flows', 'workerCores', 'compact', 'measured']),
    )
    expect(at(inside('param rows "Rows per batch" {', 'hint: |')).labels).toEqual([])
    expect(at(`${checkout.replace('title: "Checkout pipeline"', 'title: |')}`).labels).toEqual([])
    expect(at(inside('node db "Postgres" "primary" {', 'plural: |')).labels).toEqual(['true', 'false'])
    expect(at(checkout.replace('memberLabel: `broker ${i}`', 'memberLabel: |')).labels).toEqual(['i'])
  })

  it('offers the values of an enum and the flows of a fan-out', () => {
    expect(at(inside('node db "Postgres" "primary" {', 'shape: c|')).labels).toEqual(['box', 'cylinder'])
    expect(at(checkout.replace('speed: 10', 'fullScreen: [verdict, li|]')).labels).toContain('limits')
    expect(at(inside('flow orders "orders" {', 'color: |')).labels).toEqual([
      'accent',
      'alt',
      'ok',
      'warn',
      'drop',
      'muted',
    ])
    const fan = at(alerts.replace('alerts -> contacts: 1', 'alerts -> contacts: 1\n    positions -> |'))
    expect(fan.labels).toEqual(expect.arrayContaining(['contacts', 'responders', 'watchers']))
  })

  it('works in a block that is not closed yet', () => {
    expect(at('loadmap 1\nflow a {\n  ra|').labels).toContain('rate')
  })
})

describe('share links', () => {
  it('give back the definition and the values', async () => {
    const link = await encodeShare(alerts, { load: 25, merge: false, posPods: 8 })
    expect(link.startsWith('v1.')).toBe(true)
    expect(link.endsWith('&load=25&merge=false&posPods=8')).toBe(true)
    // values come back as written; the editor reads them by each parameter's kind
    expect(await decodeShare(`#${link}`)).toEqual({
      source: alerts,
      values: { load: '25', merge: 'false', posPods: '8' },
    })
  })

  it('stay short enough to paste', async () => {
    expect((await encodeShare(alerts)).length).toBeLessThan(3000)
    expect((await encodeShare(checkout)).length).toBeLessThan(3000)
  })

  it('say what is wrong with a broken link instead of throwing', async () => {
    const link = await encodeShare(checkout)
    expect(await decodeShare('#example=checkout')).toEqual({ error: 'this link holds no loadmap definition' })
    expect(await decodeShare(link.slice(0, 40))).toEqual({ error: 'this link is cut or garbled' })
    expect(await decodeShare('v1.***')).toEqual({ error: 'this link is cut or garbled' })
    const bomb = await encodeShare('x'.repeat(MAX_SHARED_BYTES + 1))
    expect(await decodeShare(bomb)).toEqual({ error: 'this link unpacks to more than 1 MB' })
  })
})

describe('completions for expect', () => {
  it('offer the scenarios by their labels, quoted when they need it', () => {
    const src = checkout.replace('scenario "Proposed"', 'scenario "Two gateways" { gateways: 2 }\nscenario "Proposed"')
    const { labels, c } = at(`${src}\nexpect { scenario: | }`)
    expect(labels).toEqual(['Today', 'Two gateways', 'Proposed'])
    expect(c.options.map((o) => o.apply)).toEqual(['Today', '"Two gateways"', 'Proposed'])
    expect(at(`${checkout}\nexpect { component: | }`).labels).toEqual(['gateway', 'workers', 'db'])
  })
})

describe('completions for tier', () => {
  it('offer the tiers declared', () => {
    expect(at(checkout.replace('  tier: edge', '  tier: |')).labels).toEqual(['edge', 'services', 'data'])
  })
})
