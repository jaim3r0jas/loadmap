// The editor opened with `?repo=…`: the model it names, or the list to pick one from when it names none. Loaded only
// when the address asks for a repository.
import { type Listing, list, type Opened, open } from './load'
import { type RepoTarget, targetFromQuery } from './parse'
import { gh } from './session'

export type Started =
  | { opened: Opened }
  /** A repository with several models and none named: the dialog lists them. */
  | { listing: Listing; target: RepoTarget }
  | { error: string }

export async function fromQuery(q: URLSearchParams): Promise<Started> {
  const target = targetFromQuery(q)
  if (!target) return { error: 'The address names no repository' }
  if ('error' in target) return target
  try {
    const listing = await list(gh, target)
    const missed = missedFile(target, listing)
    if (missed) return { error: missed }
    const path = listing.want ?? (listing.files.length === 1 && !listing.folder ? listing.files[0]!.path : undefined)
    if (path) return { opened: await open(gh, listing, path) }
    if (!listing.files.length) return { error: `${target.owner}/${target.name} has no .loadmap file at ${listing.ref}` }
    return { listing, target }
  } catch (e) {
    return { error: e instanceof Error ? e.message.replace(/\.$/, '') : 'GitHub could not be read' }
  }
}

/** The file an address named, when the listing does not hold it. */
export function missedFile(target: RepoTarget, listing: Listing): string | undefined {
  if (listing.want || (target.path == null && target.rest?.kind !== 'blob')) return undefined
  return `${target.path ?? 'That file'} is not a .loadmap file of ${target.owner}/${target.name} at ${listing.ref}`
}
