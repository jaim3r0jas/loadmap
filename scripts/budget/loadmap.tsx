// The smallest page a user writes: one <Loadmap>. The budget measures what it loads first.
import { Loadmap } from '@loadmap/react'
import { createRoot } from 'react-dom/client'
import { checkout } from '../../examples/checkout/model'
import { view } from '../../examples/checkout/view'

createRoot(document.getElementById('root')!).render(<Loadmap model={checkout} view={view} />)
