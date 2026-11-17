import { flatten } from '@loadmap/dsl'
import platform from './platform.loadmap?raw'
import region from './region.loadmap?raw'
import even from './regions.even.loadmap?raw'
import source from './regions.loadmap?raw'
import story from './regions.story.loadmap?raw'

export { regions } from './model'
export { Regions } from './Regions'
export { view } from './view'
export const regionsSource = source
/** The model in its files, as `compile(source, { path, files })` and a share link take them; the variant beside it. */
export const regionsFiles = {
  path: 'regions.loadmap',
  files: {
    'regions.loadmap': source,
    'regions.story.loadmap': story,
    'region.loadmap': region,
    'platform.loadmap': platform,
    'regions.even.loadmap': even,
  },
}

const flat = flatten(source, regionsFiles)
/** The model and its files as one text that draws and computes the same (`loadmap bundle`): for a host that reads one. */
export const regionsOne = 'text' in flat ? flat.text : source
