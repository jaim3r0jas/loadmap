// A page with the editor: the budget measures what it loads beyond a <Loadmap> page.
import { LoadmapEditor } from '@loadmap/editor'
import { createRoot } from 'react-dom/client'
import source from '../../examples/checkout/checkout.loadmap?raw'

createRoot(document.getElementById('root')!).render(<LoadmapEditor initial={source} />)
