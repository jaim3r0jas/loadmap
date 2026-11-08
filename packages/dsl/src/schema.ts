import type { Expr } from './ast'

/**
 * Every statement of the language: what follows its keyword, its properties and what it may hold. The checker,
 * autocomplete and the language reference (docs/dsl.md) all read this table, so it is the one place to add a feature.
 */

/** `o[k]` for an own entry only: a name like "constructor" must not find what every object inherits. */
export function own<T>(o: Readonly<Record<string, T>>, k: string): T | undefined {
  return Object.hasOwn(o, k) ? o[k] : undefined
}

/** What a formula may read: everything, only the parameters, a local (`i`, `value`) or nothing (a constant). */
export type Scope = 'ctx' | 'values' | 'i' | 'value' | 'const'

export type ValueKind =
  | 'number'
  | 'boolean'
  | 'string'
  | 'capacity'
  /** A word from `values`, written bare or quoted: `shape: cylinder`. */
  | 'enum'
  /** Names joined by "->": `route: gateway -> topic -> workers`. */
  | 'route'
  /** The id of a node, a component, a flow. */
  | 'node'
  | 'component'
  /** A scenario's label, bare or quoted: `scenario: Proposed`. */
  | 'scenario'
  /** The id of a tier: `tier: data`. */
  | 'tier'
  /** A list of options: `[2, 3, 4]`. */
  | 'options'
  /** A list of words from `values`, bare or quoted: `fullScreen: [verdict, controls]`. */
  | 'names'
  /** A number, a switch or an option: a parameter's default. */
  | 'value'

export interface PropSpec {
  value: ValueKind
  scope: Scope
  doc: string
  required?: boolean
  values?: readonly string[]
  /** May appear more than once; each adds to a list. */
  repeat?: boolean
  /** The editor's inspector shows it first; every other property waits under "More". */
  inspector?: 'main'
}

export interface ArgSpec {
  name: 'id' | 'label' | 'sub' | 'version' | 'x' | 'y'
  kind: 'id' | 'text' | 'number'
  optional?: boolean
  /** A text that may be a template computed from the model. */
  dynamic?: boolean
}

/**
 * Which argument of a statement fills which slot: by kind, in order, optional slots skipped. `bad` are the ones that
 * fit no slot, `missing` the first required slot left empty.
 */
export function matchArgs(slots: readonly ArgSpec[], args: readonly Expr[]) {
  const open = [...slots]
  const filled = new Map<ArgSpec, Expr>()
  const bad: Expr[] = []
  for (const a of args) {
    const kind = a.t === 'id' ? 'id' : a.t === 'str' || a.t === 'tpl' ? 'text' : a.t === 'num' ? 'number' : null
    const i = open.findIndex((s) => s.kind === kind)
    if (kind == null || i < 0 || open.slice(0, i).some((s) => !s.optional)) bad.push(a)
    else filled.set(open.splice(0, i + 1).at(-1)!, a)
  }
  return { filled, bad, missing: open.find((s) => !s.optional) }
}

export interface BlockSpec {
  doc: string
  /** An example line, shown by autocomplete. */
  example: string
  args: readonly ArgSpec[]
  /** `let x = …`. */
  init?: boolean
  props: Readonly<Record<string, PropSpec>>
  /** Keywords of the statements it may hold. */
  children: readonly string[]
  /** Its properties are named by the model: the load and parameters in a preset, parameters only in a scenario, flows in partitions. */
  open?: { names: 'values' | 'params' | 'flows'; spec: PropSpec }
  /** It holds `a -> b` lines: edges at the top, branches in a fan-out. */
  edges?: 'edges' | 'branches'
  /** It holds rows of numbers. */
  rows?: boolean
  /** The inspector's Model tab shows it (a top-level statement). */
  inspector?: 'model'
}

const STAGE_LABEL: ArgSpec[] = [
  { name: 'id', kind: 'id', optional: true },
  { name: 'label', kind: 'text', optional: true },
]
const STAGE_COMPONENT: PropSpec = {
  value: 'component',
  scope: 'const',
  doc: "The component whose capacity this stage uses. Defaults to its box's component.",
}

/** A component's properties: on a box, or in a `component` block. */
export const COMPONENT_PROPS: Readonly<Record<string, PropSpec>> = {
  name: { value: 'string', scope: 'const', doc: "The component's name in the limits list. Defaults to the label." },
  short: { value: 'string', scope: 'const', doc: 'The name inside a sentence, with its article: "the database".' },
  plural: { value: 'boolean', scope: 'const', doc: '"are past capacity" instead of "is".' },
  demand: {
    inspector: 'main',
    value: 'number',
    scope: 'ctx',
    doc: "What the component must handle, in its capacity's unit. Without one: the units per second reaching its stages.",
  },
  capacity: {
    inspector: 'main',
    value: 'capacity',
    scope: 'ctx',
    doc: 'What it can handle: measured(value, unit, source) or estimated(value, unit, source), `value ± 30%` saying how sure it is; configured(value, unit, source) for a limit someone set.',
  },
  when: { value: 'boolean', scope: 'ctx', doc: 'The component is switched off (no utilization) while this is false.' },
  over: { value: 'string', scope: 'ctx', doc: 'What happens past 100 %, as a clause: "clients get 429s".' },
  describe: { value: 'string', scope: 'ctx', doc: 'One line under the name in the limits list.' },
}

const BOX_ARGS: ArgSpec[] = [
  { name: 'id', kind: 'id' },
  { name: 'label', kind: 'text', optional: true, dynamic: true },
  { name: 'sub', kind: 'text', optional: true, dynamic: true },
]
const SUB: PropSpec = { value: 'string', scope: 'ctx', doc: 'The second line of the box.' }
const TIER: PropSpec = {
  value: 'tier',
  scope: 'const',
  doc: 'The tier the box stands in; without one, that of the boxes that feed it.',
}
const OVERLOAD_WHEN: PropSpec = { value: 'boolean', scope: 'ctx', doc: 'The rule applies only while this is true.' }

/** The panels of `<Loadmap>` below the diagram, as its `fullScreen` prop names them. */
export const PANELS = ['verdict', 'live', 'limits', 'controls', 'headroom', 'compare', 'assumptions'] as const

/** What full screen opens with, as the `fullScreenMode` prop of `<Loadmap>` names it. */
export const FULL_SCREEN_MODES = ['panels', 'focus'] as const

export const COLORS = ['accent', 'alt', 'ok', 'warn', 'drop', 'muted'] as const

/** The directions, `direction: right | down`, also read under their old name, `layout:`, from before `layout: compact`. */
export const DIRECTIONS = ['right', 'down'] as const

export const SCHEMA: Readonly<Record<string, BlockSpec>> = {
  // the document itself
  '': {
    doc: 'A loadmap definition.',
    example: '',
    args: [],
    props: {
      title: { inspector: 'main', value: 'string', scope: 'const', doc: 'The heading above the diagram.' },
      direction: {
        value: 'enum',
        scope: 'const',
        values: DIRECTIONS,
        doc: 'Which way the diagram runs. Default right, or down when its widest layer has more boxes than its longest chain. Narrow screens always run down.',
      },
      layout: {
        value: 'enum',
        scope: 'const',
        values: ['compact', 'stable'],
        doc: 'compact (the default) lays out each scenario, story step, preset and choice of a select or switch on its own and moves the boxes from one to the next; stable gives every box one place, the largest it needs anywhere, so none of them moves a box. Neither the load nor a range moves one.',
      },
      speed: { value: 'number', scope: 'const', doc: 'Simulated seconds per real second. Default 10.' },
      transition: {
        value: 'number',
        scope: 'const',
        doc: 'Seconds the diagram takes to move to a new structure (a scenario, a story step, a control that adds pods); 0 cuts. Default 0.8, at most 5; with reduced motion it cuts.',
      },
      fullScreen: {
        value: 'names',
        scope: 'const',
        values: PANELS,
        doc: 'The panels full screen shows, compact, below the diagram. Default all of them.',
      },
      fullScreenMode: {
        value: 'enum',
        scope: 'const',
        values: FULL_SCREEN_MODES,
        doc: 'What full screen opens with: the panels, or focus (the diagram, the story, the verdict and the load). Default panels.',
      },
      assume: { value: 'string', scope: 'const', repeat: true, doc: 'A line added before the generated assumptions.' },
      searchMax: {
        value: 'number',
        scope: 'const',
        doc: 'The highest load multiple the limits search. Default 2000.',
      },
    },
    children: [
      'loadmap',
      'load',
      'param',
      'preset',
      'scenario',
      'growth',
      'expect',
      'step',
      'let',
      'fit',
      'flow',
      'component',
      'node',
      'cluster',
      'pool',
      'tier',
      'thresholds',
    ],
    edges: 'edges',
  },
  loadmap: {
    doc: 'The first line: the version of the language this definition is written in.',
    example: 'loadmap 1',
    args: [{ name: 'version', kind: 'number' }],
    props: {},
    children: [],
  },
  load: {
    inspector: 'model',
    doc: 'The load, as a multiple of today. It drives the limits.',
    example: 'load "Users, × today" { max: 100; default: 10 }',
    args: [{ name: 'label', kind: 'text', optional: true }],
    props: {
      min: { value: 'number', scope: 'const', doc: 'The lowest multiple. Default 1.' },
      max: {
        inspector: 'main',
        value: 'number',
        scope: 'const',
        doc: 'The highest multiple on the slider.',
        required: true,
      },
      step: { value: 'number', scope: 'const', doc: 'The slider step. Default 1.' },
      default: {
        inspector: 'main',
        value: 'number',
        scope: 'const',
        doc: 'Where the slider starts. Default the minimum.',
      },
    },
    children: [],
  },
  param: {
    inspector: 'model',
    doc: 'A control: options make a select, min and max a slider, a true or false default a switch.',
    example: 'param pods "Worker pods" { options: [2, 3, 4, 6]; default: 3 }',
    args: [
      { name: 'id', kind: 'id' },
      { name: 'label', kind: 'text', optional: true },
    ],
    props: {
      options: {
        inspector: 'main',
        value: 'options',
        scope: 'const',
        doc: 'The choices of a select: [2, 3, 4] or ["a", "b"].',
      },
      min: { inspector: 'main', value: 'number', scope: 'const', doc: 'The lowest value of a slider.' },
      max: { inspector: 'main', value: 'number', scope: 'const', doc: 'The highest value of a slider.' },
      step: { inspector: 'main', value: 'number', scope: 'const', doc: 'The step of a slider. Default 1.' },
      default: { inspector: 'main', value: 'value', scope: 'const', doc: 'The starting value.', required: true },
      hint: { value: 'string', scope: 'const', doc: 'One line under the control.' },
      tag: { value: 'string', scope: 'const', doc: 'A short tag next to the label, e.g. "estimate".' },
      enabled: {
        value: 'boolean',
        scope: 'values',
        doc: 'Greys the control out while this is false; it reads only parameters.',
      },
      format: { value: 'string', scope: 'value', doc: 'How a value is shown, from `value`: `${value} pods`.' },
    },
    children: [],
  },
  preset: {
    doc: 'A named set of values, offered as a button.',
    example: 'preset "Black Friday" { load: 40; pods: 6 }',
    args: [{ name: 'label', kind: 'text' }],
    props: {},
    children: [],
    open: { names: 'values', spec: { value: 'value', scope: 'const', doc: 'A value of the load or a parameter.' } },
  },
  scenario: {
    doc: 'A named design to compare: the defaults plus these values, never the load. The first is the baseline.',
    example: 'scenario "Proposed" { pods: 6; gateways: 2 }',
    args: [{ name: 'label', kind: 'text' }],
    props: {},
    children: [],
    open: { names: 'params', spec: { value: 'value', scope: 'const', doc: 'A value of a parameter.' } },
  },
  growth: {
    inspector: 'model',
    doc: 'How fast the load grows, compounded from asOf, where it is 1×: load multiples become dates.',
    example: 'growth { rate: 0.06; per: month; asOf: "2026-11-01" }',
    args: [],
    props: {
      rate: {
        inspector: 'main',
        value: 'number',
        scope: 'const',
        required: true,
        doc: 'Growth per period, as a share: 0.06 is 6 %.',
      },
      per: { value: 'enum', scope: 'const', values: ['month', 'year'], required: true, doc: 'month or year.' },
      asOf: { value: 'string', scope: 'const', required: true, doc: 'The day the load is 1×: "2026-11-01".' },
    },
    children: [],
  },
  expect: {
    doc: 'What must keep holding, on the pessimistic edge (every capacity at its low bound): `loadmap check` fails when it does not.',
    example: 'expect "Today keeps 7×" { target: 7 }',
    args: [{ name: 'label', kind: 'text', optional: true }],
    props: {
      scenario: {
        value: 'scenario',
        scope: 'const',
        doc: 'The scenario whose values it checks; the defaults without one.',
      },
      component: { value: 'component', scope: 'const', doc: 'One component; the first limit without one.' },
      target: { value: 'number', scope: 'const', doc: 'The target holds up to at least this load multiple.' },
      full: { value: 'number', scope: 'const', doc: 'Nothing (or the component) runs out before this load multiple.' },
    },
    children: [],
  },
  step: {
    doc: 'A step of the story the page walks through, in order: its text, and the values to show it at. Play (and `loadmap record --story`) shows the whole diagram, closes in on what the step changes, changes it, and steps back.',
    example: 'step "At 30×, the workers run out first." { load: 30; focus: workers; title: "Users to 30×" }',
    args: [{ name: 'label', kind: 'text' }],
    props: {
      scenario: {
        value: 'scenario',
        scope: 'const',
        doc: "Start from this scenario's values; without one, from the defaults.",
      },
      title: {
        value: 'string',
        scope: 'const',
        doc: 'The few words the diagram shows while Play shows the step. Default: what the step changes.',
      },
      focus: { value: 'component', scope: 'const', doc: 'The component to point at: its box is outlined.' },
      seconds: {
        value: 'number',
        scope: 'const',
        doc: 'How long Play holds the whole diagram after the step changes it: the time to read it. Default 4.',
      },
    },
    children: [],
    open: { names: 'values', spec: { value: 'value', scope: 'const', doc: 'A value of the load or a parameter.' } },
  },
  let: {
    inspector: 'model',
    doc: 'A named formula other formulas can use by its name.',
    example: 'let perPosition = watchOnly ? 0.3 : 1.2',
    args: [{ name: 'id', kind: 'id' }],
    init: true,
    props: {},
    children: [],
  },
  fit: {
    inspector: 'model',
    doc: 'cost = a + b × x, fitted from measured points. Call it like a function: workerCores(rate).',
    example: 'fit workerCores "Worker CPU per request" { source: "load test"; points rate cores { 200 0.26 } }',
    args: [
      { name: 'id', kind: 'id' },
      { name: 'label', kind: 'text', optional: true },
    ],
    props: {
      source: { value: 'string', scope: 'const', doc: 'Where the points came from.' },
      through: { value: 'enum', scope: 'const', values: ['origin'], doc: 'origin: a cost with no idle part (a = 0).' },
    },
    children: ['points'],
  },
  points: {
    doc: 'The measured points of a fit: the names of x and y, then one "x y" row per line.',
    example: 'points rate cores {\n  200 0.2599\n  350 0.3061\n}',
    args: [
      { name: 'x', kind: 'id' },
      { name: 'y', kind: 'id' },
    ],
    props: {},
    children: [],
    rows: true,
  },
  flow: {
    inspector: 'model',
    doc: 'Something that moves through the system, with its rate and its route.',
    example: 'flow orders "orders" { unit: "order"; rate: 40 * load; route: gateway -> topic -> workers }',
    args: [
      { name: 'id', kind: 'id' },
      { name: 'label', kind: 'text', optional: true },
    ],
    props: {
      unit: { value: 'string', scope: 'const', doc: 'One unit of the flow, singular: "order".' },
      rate: { inspector: 'main', value: 'number', scope: 'ctx', doc: 'Units per second.', required: true },
      priority: { value: 'number', scope: 'const', doc: '1 is served first. Flows of the same priority share.' },
      route: { value: 'route', scope: 'const', doc: 'The stages it passes, in order: a -> b -> c.', required: true },
      from: { value: 'node', scope: 'const', doc: 'The node its dots start from.', required: true },
      color: {
        value: 'enum',
        scope: 'const',
        values: COLORS,
        doc: 'A theme colour (accent, alt, ok, warn, drop, muted) or a CSS colour in quotes.',
      },
    },
    children: ['drop', 'merge', 'retry'],
  },
  drop: {
    doc: 'Units older than olderThan simulated seconds are dropped before they are handled.',
    example: 'drop { olderThan: 60; reason: "too old" }',
    args: [],
    props: {
      olderThan: { value: 'number', scope: 'ctx', doc: 'Seconds.', required: true },
      reason: { value: 'string', scope: 'ctx', doc: 'Shown with the drop meter.' },
      when: OVERLOAD_WHEN,
    },
    children: [],
  },
  merge: {
    doc: 'Under backlog, this share of what is handled is superseded by a newer unit: keep the newest per key.',
    example: 'merge { share: 0.37; reason: "newest kept" }',
    args: [],
    props: {
      share: { value: 'number', scope: 'ctx', doc: 'The share superseded, 0 to 1.', required: true },
      reason: { value: 'string', scope: 'ctx', doc: 'Shown with the meter.' },
      when: OVERLOAD_WHEN,
    },
    children: [],
  },
  retry: {
    doc: 'A unit turned away on the route (by a pass, limit or cache stage past capacity) is sent again, up to times more times. The attempts settle where the retries they cause are the ones assumed.',
    example: 'retry { times: 3; budget: 0.1 }',
    args: [],
    props: {
      times: {
        inspector: 'main',
        value: 'number',
        scope: 'values',
        doc: 'Retries after the first attempt: a whole number. Reads only the parameters.',
        required: true,
      },
      budget: {
        inspector: 'main',
        value: 'number',
        scope: 'values',
        doc: 'At most this share of the flow is added as retries: 0.1 adds at most 10 %. Without one, every retry is sent.',
      },
      when: {
        value: 'boolean',
        scope: 'values',
        doc: 'The rule applies only while this is true; it reads only parameters.',
      },
    },
    children: [],
  },
  component: {
    doc: 'Something that can run out: its demand against its capacity. On a box, write these lines on the box.',
    example: 'component cache "Cache" { demand: flows.reads; capacity: estimated(9000, "req/s") }',
    args: [
      { name: 'id', kind: 'id', optional: true },
      { name: 'label', kind: 'text', optional: true },
    ],
    props: COMPONENT_PROPS,
    children: [],
  },
  tier: {
    doc: 'A lane across the flow (edge, app, data) drawn behind its boxes, its name in a header. Tiers run in the order they are declared.',
    example: 'tier data "Data"',
    args: [
      { name: 'id', kind: 'id' },
      { name: 'label', kind: 'text', optional: true },
    ],
    props: {},
    children: [],
  },
  node: {
    doc: 'A box. It may run a stage (pass, store, sink, fanout) and own a component (demand and capacity lines).',
    example: 'node gateway "API gateway" { pass; demand: flows.orders; capacity: estimated(20000, "req/s") }',
    args: BOX_ARGS,
    props: {
      sub: SUB,
      shape: { value: 'enum', scope: 'const', values: ['box', 'cylinder'], doc: 'box (the default) or cylinder.' },
      tier: TIER,
      ...COMPONENT_PROPS,
    },
    children: ['pass', 'store', 'sink', 'fanout', 'cache', 'limit', 'component'],
  },
  cluster: {
    doc: 'Members (brokers) holding the partitions of one or more queues (topics).',
    example: 'cluster kafka "Kafka" { members: 3; queue topic { partitions { orders: 12 } } }',
    args: BOX_ARGS,
    props: {
      sub: SUB,
      members: { inspector: 'main', value: 'number', scope: 'ctx', doc: 'How many members.', required: true },
      memberLabel: { value: 'string', scope: 'i', doc: "Each member's label, from its index i: `broker ${i}`." },
      tier: TIER,
      ...COMPONENT_PROPS,
    },
    children: ['queue', 'component'],
  },
  pool: {
    doc: 'A workers stage drawn as pods holding a grid of workers.',
    example: 'pool workers "Workers" { workers { pods: pods; perPod: 8 } }',
    args: BOX_ARGS,
    props: {
      sub: SUB,
      podLabel: { value: 'string', scope: 'i', doc: "Each pod's label, from its index i: `pod ${i}`." },
      tier: TIER,
      ...COMPONENT_PROPS,
    },
    children: ['workers', 'component'],
  },
  pass: {
    doc: 'Flows pass through; past capacity the share above 100 % is rejected.',
    example: 'pass "the gateway"',
    args: STAGE_LABEL,
    props: { component: STAGE_COMPONENT },
    children: [],
  },
  cache: {
    doc: 'A share of the units (hit) is answered here and goes no further; the rest carry on to the next stage. Past capacity the share above 100 % is rejected.',
    example: 'cache { hit: 0.8 }',
    args: STAGE_LABEL,
    props: {
      hit: {
        inspector: 'main',
        value: 'number',
        scope: 'ctx',
        doc: 'The share answered here, 0 to 1.',
        required: true,
      },
      component: STAGE_COMPONENT,
    },
    children: [],
  },
  limit: {
    doc: "A rate limiter: its component's capacity is the limit. Above it the share over is turned away, and the stages after it see only what got through.",
    example: 'limit',
    args: STAGE_LABEL,
    props: { component: STAGE_COMPONENT },
    children: [],
  },
  store: {
    doc: 'Where a flow ends: written to its component.',
    example: 'store',
    args: STAGE_LABEL,
    props: { component: STAGE_COMPONENT },
    children: [],
  },
  sink: {
    doc: 'Where a flow ends without a component: a receiver, a viewer.',
    example: 'sink "contacts"',
    args: STAGE_LABEL,
    props: {},
    children: [],
  },
  queue: {
    doc: 'Flows wait here; the next stage of each route drains it.',
    example: 'queue topic "orders topic" { partitions { orders: 12 } }',
    args: STAGE_LABEL,
    props: { component: STAGE_COMPONENT },
    children: ['partitions'],
  },
  partitions: {
    doc: 'Partitions per flow, drawn as cells across the members.',
    example: 'partitions { orders: 12; events: 24 }',
    args: [],
    props: {},
    children: [],
    open: { names: 'flows', spec: { value: 'number', scope: 'ctx', doc: 'Partitions of this flow.' } },
  },
  workers: {
    doc: 'A pool of workers: pods × workers per pod.',
    example: 'workers { pods: pods; perPod: 8 }',
    args: STAGE_LABEL,
    props: {
      pods: {
        inspector: 'main',
        value: 'number',
        scope: 'ctx',
        doc: 'How many pods; an autoscaled pool has autoscale instead.',
      },
      perPod: { inspector: 'main', value: 'number', scope: 'ctx', doc: 'Workers per pod.', required: true },
      fill: {
        value: 'enum',
        scope: 'const',
        values: ['round-robin', 'in-order'],
        doc: 'round-robin spreads work across pods (the default); in-order fills pod 0 first.',
      },
      component: STAGE_COMPONENT,
    },
    children: ['autoscale'],
  },
  autoscale: {
    doc: "Pods are added and removed to hold each running pod near target, between min and max. The component's capacity is the pool at max pods: it runs out when the pool cannot grow further.",
    example: 'autoscale { min: 2; max: 10; target: 0.7 }',
    args: [],
    props: {
      min: { inspector: 'main', value: 'number', scope: 'ctx', doc: 'The fewest pods, at least 1.', required: true },
      max: { inspector: 'main', value: 'number', scope: 'ctx', doc: 'The most pods.', required: true },
      target: {
        inspector: 'main',
        value: 'number',
        scope: 'ctx',
        doc: 'The utilization each running pod is held at, above 0 and at most 1: 0.7 scales out above 70 %.',
        required: true,
      },
    },
    children: [],
  },
  fanout: {
    doc: 'Each unit is copied to several stages; one "flow -> stage: copies" line per branch. Last on a route.',
    example: 'fanout "push broker" {\n  alerts -> contacts: 1\n}',
    args: STAGE_LABEL,
    props: { component: STAGE_COMPONENT },
    children: [],
    edges: 'branches',
  },
  thresholds: {
    inspector: 'model',
    doc: 'The utilization of the target and of "runs out".',
    example: 'thresholds { target: 0.5; full: 1 }',
    args: [],
    props: {
      target: { value: 'number', scope: 'const', doc: 'Default 0.5.' },
      full: { value: 'number', scope: 'const', doc: 'Default 1.' },
    },
    children: [],
  },
}

/** The properties of an edge's block: `a -> b { label: …; when: … }`. */
export const EDGE_PROPS: Readonly<Record<string, PropSpec>> = {
  label: { value: 'string', scope: 'ctx', doc: 'The text on the edge.' },
  when: { value: 'boolean', scope: 'ctx', doc: 'The edge is left out while this is false.' },
}

export const BOXES = ['node', 'cluster', 'pool'] as const
export const STAGES = ['pass', 'store', 'sink', 'queue', 'workers', 'fanout', 'cache', 'limit'] as const
