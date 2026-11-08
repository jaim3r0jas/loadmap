import { compile } from '@loadmap/dsl'
import { TEMPLATES } from '@loadmap/editor/templates'
import { alerts, view as alertsView } from '@loadmap/example-alerts'
import { checkout, view as checkoutView } from '@loadmap/example-checkout'
import { describe, expect, it } from 'vitest'
import { features } from '../site/features'

const template = (id: string) => {
  const def = compile(TEMPLATES.find((t) => t.id === id)!.source).definition!
  return features(def.model, def.view)
}

describe('the features a model shows', () => {
  it('reads the examples', () => {
    expect(features(checkout, checkoutView)).toEqual([
      'queue',
      'priority',
      'drop',
      '± range',
      'fit',
      'tiers',
      'scenarios',
      'growth',
      'expectations',
      'story',
    ])
    expect(features(alerts, alertsView)).toEqual(expect.arrayContaining(['fan-out', 'merge', 'priority', 'story']))
  })

  it('reads each building block from its template', () => {
    expect(template('cache')).toContain('cache')
    expect(template('rate-limit')).toContain('rate limiter')
    expect(template('autoscale')).toContain('autoscale')
    // retries a parameter turns on in a scenario count too
    expect(template('retry-storm')).toContain('retries')
    expect(template('notifications')).toContain('fan-out')
  })

  it('names nothing a model does not use, and a lone scenario as none, as the board shows no comparison', () => {
    const bare = compile(
      [
        'loadmap 1',
        'load "Users" { max: 10; default: 1 }',
        'flow reqs "requests" { rate: 10 * load; route: app; from: users }',
        'node users "Users"',
        'node app "App" {',
        '  pass',
        '  demand: flows.reqs',
        '  capacity: measured(100, "req/s", "a test")',
        '  over: "requests fail"',
        '}',
        'scenario "Today" {}',
        '',
      ].join('\n'),
    )
    expect(bare.diagnostics).toEqual([])
    expect(features(bare.definition!.model, bare.definition!.view)).toEqual([])
    for (const t of TEMPLATES) {
      const def = compile(t.source).definition!
      expect(features(def.model, def.view), t.id).not.toContain('stable layout')
    }
  })
})
