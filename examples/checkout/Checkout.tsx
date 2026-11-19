import { Loadmap, type LoadmapHandle, type LoadmapPanel, type Theme } from '@loadmap/react'
import type { Ref } from 'react'
import { checkout } from './model'
import { view } from './view'

/**
 * `zoom`: the reader pans and zooms the board. The docs' home page draws it filling its frame (`fill`), with the
 * verdict alone below the diagram (`fullScreen`), no headroom chart and no comparison.
 */
export function Checkout({
  theme,
  ref,
  zoom,
  headroom,
  compare,
  fill,
  fullScreen,
}: {
  theme?: Theme
  ref?: Ref<LoadmapHandle>
  zoom?: boolean
  headroom?: boolean
  compare?: boolean
  fill?: boolean
  fullScreen?: readonly LoadmapPanel[]
}) {
  return (
    <Loadmap
      ref={ref}
      model={checkout}
      view={view}
      speed={10}
      fullScreenMode="focus"
      theme={theme}
      zoom={zoom}
      headroom={headroom}
      compare={compare}
      fill={fill}
      fullScreen={fullScreen}
      assumptions={['Load scales linearly with users; 1× is the 5-minute peak of an ordinary day.']}
    />
  )
}
