import { execFile } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { COMMENT_MARKER } from '../src/base'
import { type CheckedFile, check } from '../src/check'

const git = promisify(execFile)

const shop = (api: number, db: number) => `loadmap 1
load { max: 50 }
growth { rate: 0.1; per: month; asOf: "2026-11-01" }

flow req "requests" { rate: 100 * load; from: users; route: api -> db }

node users "Users"
node api "API" {
  pass
  demand: flows.req
  capacity: measured(${api}, "req/s", "load test")
  over: "clients get 503s"
}
node db "DB" {
  store
  demand: flows.req
  capacity: measured(${db}, "req/s", "load test")
  over: "writes queue"
}

users -> api -> db
`

/** A repository whose main holds the base, and whose working tree holds the change. */
async function repo(base: string, head: string) {
  const dir = await mkdtemp(join(tmpdir(), 'loadmap-base-'))
  const path = join(dir, 'shop.loadmap')
  const g = (...args: string[]) =>
    git('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=T', ...args], { cwd: dir })
  await g('init', '-q', '-b', 'main')
  await writeFile(path, base)
  await g('add', 'shop.loadmap')
  await g('commit', '-q', '-m', 'base')
  await writeFile(path, head)
  return { dir, path }
}

async function run(argv: string[], env: Record<string, string> = {}) {
  const lines: string[] = []
  const code = await check(argv, { log: (l) => lines.push(l), env })
  return { code, out: lines.join('\n') }
}

describe('loadmap check --base', () => {
  it('passes a change that keeps its headroom, and says nothing moved', async () => {
    const { path } = await repo(shop(1000, 2000), shop(1000, 3000))
    const r = await run([path, '--base', 'main'])
    expect(r.code).toBe(0)
    expect(r.out).toContain(`${path}: against main: API stays the first limit, at 5×.`)
  })

  it('fails a change that loses headroom, on the line of the component, and says when it runs out', async () => {
    const { path } = await repo(shop(1000, 2000), shop(800, 2000))
    const r = await run([path, '--base', 'main', '--format', 'github'])
    expect(r.code).toBe(1)
    // the API is declared on line 8
    expect(r.out).toMatch(
      /^::error file=[^,]*shop\.loadmap,line=8,col=6,.*::against main, the 50 %25 target holds up to 4× instead of 5×: 20 %25 less \(1× fewer\), more than the 10 %25 allowed$/m,
    )
    expect(r.out).toContain(
      'against main: API stays the first limit, now at 4× instead of 5×, and runs out in August 2028 instead of November 2028.',
    )
    // a tolerance that allows it, or an accepted loss, lets it through
    expect((await run([path, '--base', 'main', '--tolerance', '25%'])).code).toBe(0)
    expect((await run([path, '--base', 'main', '--tolerance', '1×'])).code).toBe(0)
    const accepted = await run([path, '--base', 'main', '--accept', 'A smaller API, agreed with ops'])
    expect(accepted.code).toBe(0)
    expect(accepted.out).toMatch(
      /warning: against main, the 50 % target holds up to 4× .* \(accepted: A smaller API, agreed with ops\)/,
    )
  })

  it('writes the comment: the sentence, what fails, the table and the assumptions, behind its marker', async () => {
    const { dir, path } = await repo(shop(1000, 2000), shop(1000, 900))
    const comment = join(dir, 'comment.md')
    const json = join(dir, 'result.json')
    const r = await run([path, '--base', 'main', '--comment', comment, '--json', json])
    expect(r.code).toBe(1)
    const md = await readFile(comment, 'utf8')
    expect(md.startsWith(`${COMMENT_MARKER}\n### Capacity\n`)).toBe(true)
    expect(md).toContain(
      `**\`${path}\`** against \`main\`: The first limit moves from API at 5× to DB at 4.5×, and runs out in October 2028 instead of November 2028.`,
    )
    expect(md).toContain('- ❌ the first limit moves from API to DB')
    expect(md).toContain('| Component | Base headroom | Head headroom | Δ | 100 % at |')
    expect(md).toContain('| API | 5× | 5× | 0 | 10× |')
    expect(md).toContain('| DB | 10× | 4.5× | −55 % | 9× |')
    expect(md).toContain('- API: 1,000 req/s, measured (load test)')
    const f = (JSON.parse(await readFile(json, 'utf8')) as { files: CheckedFile[] }).files[0]!
    expect(f.outcome).toBe('fail')
    expect(f.base).toMatchObject({
      ref: 'main',
      accepted: null,
      firstLimit: { base: 'api', head: 'db' },
      target: { base: 5, head: 4.5 },
      triggers: [{ kind: 'first-limit', component: 'db', text: 'the first limit moves from API to DB' }],
    })
  })

  it('says why there is nothing to compare, and refuses a ref git does not know', async () => {
    const { dir } = await repo(shop(1000, 2000), shop(1000, 2000))
    const added = join(dir, 'new.loadmap')
    await writeFile(added, shop(1000, 2000))
    const r = await run([added, '--base', 'main'])
    expect(r.code).toBe(0)
    expect(r.out).toContain(`${added}: new at this change: nothing at main to compare`)
    // a base git cannot read fails the run, says why, and still checks the definition
    const comment = join(dir, 'comment.md')
    const bad = await run([join(dir, 'shop.loadmap'), '--base', 'nope', '--comment', comment])
    expect(bad.code).toBe(1)
    expect(bad.out).toMatch(/shop\.loadmap: cannot read it at nope \(fatal: /)
    expect(bad.out).toContain('shop.loadmap: compiles; it has no expect lines')
    expect(await readFile(comment, 'utf8')).toMatch(/shop\.loadmap`\*\*: cannot read it at nope \(fatal: /)
    expect((await run([added, '--accept', 'x'])).out).toBe(
      '--tolerance and --accept are about a change against its base: add --base <ref>',
    )
    expect((await run([added, '--base', 'main', '--tolerance', 'ten'])).code).toBe(2)
  })
})

describe('loadmap check --base --pull', () => {
  const measured = (provider: string) => `${shop(1000, 2000).replace(
    'capacity: measured(1000, "req/s", "load test")',
    'capacity: apiPeak',
  )}
metric served {
  ${provider === 'prometheus' ? 'prometheus { query: "max(rate(x[5m]))" }' : 'elasticsearch { index: "logs-*" }'}
}
measure apiPeak served { fallback: measured(1000, "req/s", "load test") }
`
  it('reads the base’s measures only from the providers the head reads', async () => {
    const { path } = await repo(measured('elasticsearch'), measured('prometheus'))
    const asked: string[] = []
    const fetch = (async (input: URL | string) => {
      asked.push(new URL(String(input)).host)
      const values = [
        [1794103200, '1000'],
        [1794103500, '1000'],
      ]
      return new Response(
        JSON.stringify({ status: 'success', data: { resultType: 'matrix', result: [{ metric: {}, values }] } }),
      )
    }) as typeof globalThis.fetch
    const lines: string[] = []
    const code = await check([path, '--base', 'main', '--pull'], {
      log: (l) => lines.push(l),
      env: { LOADMAP_PROMETHEUS_URL: 'https://prom.example' },
      fetch,
      now: () => new Date('2026-11-08T06:00:00Z'),
    })
    // the base's Elasticsearch measure is not this change's to configure
    expect(lines.join('\n')).not.toMatch(/not configured/)
    expect(code).toBe(0)
    expect(asked).toEqual(['prom.example'])
  })
})

describe('the workflow in the guide', () => {
  const guide = readFile(new URL('../../../docs/dsl.md', import.meta.url), 'utf8')
  const workflow = async () => /```yaml\n(# loadmap check on every pull request[\s\S]*?)```/.exec(await guide)![1]!

  it('follows the repository’s workflow rules', async () => {
    const w = await workflow()
    expect(w).toMatch(/^permissions: \{\}$/m)
    expect(w).not.toContain('pull_request_target')
    // every action pinned to a full SHA, with its version beside it
    const uses = [...w.matchAll(/uses: (\S+)/g)].map((m) => m[1]!)
    expect(uses.length).toBeGreaterThan(0)
    for (const u of uses) expect(u, u).toMatch(/@[0-9a-f]{40}$/)
    for (const checkout of w.split('uses: actions/checkout@').slice(1))
      expect(checkout.slice(0, 200)).toContain('persist-credentials: false')
    const jobs = [...w.matchAll(/^ {2}([a-z-]+):$/gm)].length
    expect([...w.matchAll(/timeout-minutes:/g)].length).toBe(jobs)
    expect([...w.matchAll(/^ {4}permissions:$/gm)].length).toBe(jobs)
    // nothing from an event inside a script: every value comes in through env
    for (const block of w.split(/run: \|\n/).slice(1)) {
      const body = block.split(/\n(?! {10})/)[0]!
      expect(body, body).not.toContain('${{')
    }
    for (const line of w.matchAll(/run: (?!\|)(.*)/g)) expect(line[1]).not.toContain('${{')
  })

  it('finds its comment by the marker the command writes', async () => {
    const w = await workflow()
    // \u003c is jq's "<": the guide holds no HTML comment, the workflow still finds the marker
    expect(w).toContain(`startswith("${COMMENT_MARKER.replace('<', '\\u003c')}")`)
    // only its own comment: anyone may write the marker
    expect(w).toContain('.user.login == "github-actions[bot]"')
    // a label is the approval path, so a label runs it again
    expect(w).toMatch(/types: \[.*labeled, unlabeled\]/)
    expect(w).not.toMatch(/^ {4}paths:/m)
  })
})
