// The editor opened with `?repo=…`: the model it names, or the list to pick one from when it names none. Loaded only
// when the address asks for a repository.
import { GitHubError } from './api'
import { inFolder, type Listing, list, type Opened, open } from './load'
import { type RepoTarget, targetFromQuery } from './parse'
import { noteRecent } from './repos'
import { gh } from './session'

/**
 * A failure a token can mend: a repository this browser may not see (private, or out of the token's reach), a refused
 * token or one without the permission, the limit for reading without one. A ref or a file that is not there is not.
 */
export const tokenMends = (e: unknown) =>
  e instanceof GitHubError &&
  (e.failure === 'auth' ||
    e.failure === 'unseen' ||
    (e.failure === 'forbidden' && gh.signed()) ||
    (e.failure === 'rate' && !gh.signed()))

export type Started =
  | { opened: Opened }
  /** A repository with several models and none named: the dialog lists them. */
  | { listing: Listing; target: RepoTarget }
  /** A repository a token may open: the dialog asks for one, saying why. */
  | { ask: string; target: RepoTarget }
  | { error: string }

export async function fromQuery(q: URLSearchParams): Promise<Started> {
  const target = targetFromQuery(q)
  if (!target) return { error: 'The address names no repository' }
  if ('error' in target) return target
  try {
    const listing = await list(gh, target)
    const missed = missedFile(target, listing)
    if (missed) return { error: missed }
    const here = inFolder(listing)
    const path = listing.want ?? (here.length === 1 ? here[0]!.path : undefined)
    if (path) {
      const opened = await open(gh, listing, path)
      noteRecent({ owner: listing.owner, name: listing.name, path })
      return { opened }
    }
    if (!here.length) {
      const folder = listing.folder ? `in ${listing.folder}/ ` : ''
      return { error: `${target.owner}/${target.name} has no .loadmap file ${folder}at ${listing.ref}` }
    }
    return { listing, target }
  } catch (e) {
    if (tokenMends(e)) return { ask: (e as Error).message, target }
    return { error: e instanceof Error ? e.message.replace(/\.$/, '') : 'GitHub could not be read' }
  }
}

/** The file an address named, when the listing does not hold it. */
export function missedFile(target: RepoTarget, listing: Listing): string | undefined {
  if (listing.want || (target.path == null && target.rest?.kind !== 'blob')) return undefined
  return `${target.path ?? 'That file'} is not a .loadmap file of ${target.owner}/${target.name} at ${listing.ref}`
}
