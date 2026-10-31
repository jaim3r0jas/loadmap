import { Loadmap, type LoadmapHandle, type Theme } from '@loadmap/react'
import type { Ref } from 'react'
import { checkout } from './model'
import { view } from './view'

export function Checkout({ theme, ref }: { theme?: Theme; ref?: Ref<LoadmapHandle> }) {
  return (
    <Loadmap
      ref={ref}
      model={checkout}
      view={view}
      speed={10}
      theme={theme}
      assumptions={['Load scales linearly with users; 1× is the 5-minute peak of an ordinary day.']}
    />
  )
}
