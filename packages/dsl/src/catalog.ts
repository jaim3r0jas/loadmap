import type { Catalog, ConnectionRule, Published } from '@loadmap/core'
import type { Decl } from './ast'

/**
 * The component catalog for `published` statements: loaded only for a definition that has one, so a page that never
 * names it never loads it. A host awaits `loadCatalog()` before it compiles such a text (`needsCatalog` says when);
 * the CLI and the language server load it once at the start.
 */

let editions: Readonly<Record<string, Catalog>> | undefined
let loading: Promise<Readonly<Record<string, Catalog>>> | undefined

/** A `published` statement or a connection's `rule:`, at the start of a line or after a `;` or `{`: the text needs the catalog. */
export const needsCatalog = (source: string): boolean => /(^|[;{])[ \t]*(published\b|rule[ \t]*:)/m.test(source)

const rulesOf = new WeakMap<object, ReadonlyMap<string, ConnectionRule>>()

/**
 * Every connection rule of the latest edition, by its id, worked out once a catalog. A released rule never changes (a
 * correction takes a new id: catalog.test.ts holds each one alike in every edition), so the latest one stands for all.
 */
export function catalogRules(e = editions): ReadonlyMap<string, ConnectionRule> {
  if (!e) return new Map()
  let out = rulesOf.get(e)
  if (!out) {
    const latest = e[latestEdition(e)]!
    out = new Map(Object.values(latest.components).flatMap((c) => (c.connections ?? []).map((r) => [r.id, r] as const)))
    rulesOf.set(e, out)
  }
  return out
}

/** Loads the catalog once: every edition, from loadmap's own data (never from a URL a definition names). */
export function loadCatalog(): Promise<Readonly<Record<string, Catalog>>> {
  loading ??= import('@loadmap/core/catalog').then(
    (m) => {
      editions = m.EDITIONS
      return editions
    },
    (err) => {
      // a chunk that failed to load (a dropped connection, a new deploy) is tried again next time
      loading = undefined
      throw err
    },
  )
  return loading
}

/**
 * What a host awaits before it compiles a text: the catalog, loaded when the text needs it. It never rejects: without
 * the catalog, `compile` says so on the statement that names it.
 */
export async function loadCatalogFor(source: string): Promise<void> {
  if (needsCatalog(source) && !editions) await loadCatalog().catch(() => undefined)
}

/** The catalog once loaded, or undefined. */
export const loadedCatalog = (): Readonly<Record<string, Catalog>> | undefined => editions

/** The latest edition's name. */
export const latestEdition = (e: Readonly<Record<string, Catalog>>): string => Object.keys(e).at(-1)!

/** The component a `published` statement names, in the edition it pins (the latest when it pins none yet). */
export function componentOf(d: Decl): Published | undefined {
  const e = editions
  const id = d.args[1]
  if (!e || id?.t !== 'id') return undefined
  const ed = d.body?.find((s) => s.kind === 'prop' && s.key.name === 'edition')
  const edition = ed?.kind === 'prop' && ed.value.t === 'str' ? ed.value.value : latestEdition(e)
  return catalogComponent(e, edition, id.name)
}

/** A component of an edition, by its id, or undefined: `own` lookups only, as a shared link names it. */
export function catalogComponent(
  e: Readonly<Record<string, Catalog>>,
  edition: string,
  id: string,
): Published | undefined {
  const c = Object.hasOwn(e, edition) ? e[edition] : undefined
  return c && Object.hasOwn(c.components, id) ? c.components[id] : undefined
}
