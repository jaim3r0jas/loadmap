// A page made to be framed, as the docs' embed page is: a shared link's definition compiled and drawn filling the
// frame. The budget measures what it loads first: the compiler comes with it, ELK must not.
import { compile, decodeShare, sharedValues } from '@loadmap/dsl'
import { Loadmap } from '@loadmap/react'
import { createRoot } from 'react-dom/client'

const shared = await decodeShare(location.hash)
const def = 'source' in shared ? compile(shared.source).definition : undefined
const root = createRoot(document.getElementById('root')!)
if (def && 'values' in shared)
  root.render(<Loadmap model={def.model} view={def.view} fill initial={sharedValues(def.model, shared.values)} />)
else root.render(<p>This link holds no loadmap model.</p>)
