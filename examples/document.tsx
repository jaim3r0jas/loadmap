import type { Model } from '@loadmap/core'
import type { View } from '@loadmap/layout'
import {
  Assumptions,
  Compare,
  Controls,
  Diagram,
  HeadroomChart,
  handleOf,
  Limits,
  LoadBar,
  type LoadmapHandle,
  type LoadmapOptions,
  LoadmapRoot,
  Meters,
  Story,
  type Theme,
  useLoadmap,
  Verdict,
} from '@loadmap/react'
import { type ReactNode, type Ref, useImperativeHandle } from 'react'

/**
 * A page of its own, put together from loadmap's parts as a document: the load bar and the story over the diagram, and
 * every panel whole under it. `<Loadmap>` keeps all of this in one canvas, one panel open at a time; the tests that
 * read what a panel says draw this page, where every panel shows at once.
 */
export function Document<P>({
  model,
  view,
  theme,
  assumptions,
  onNodeClick,
  selected,
  ref,
  ...o
}: LoadmapOptions<P> & {
  model: Model<P>
  view: View
  theme?: Theme
  assumptions?: readonly ReactNode[]
  onNodeClick?: (id: string) => void
  selected?: string | null
  ref?: Ref<LoadmapHandle>
}) {
  const lm = useLoadmap(model, view, o)
  useImperativeHandle(ref, () => handleOf(lm), [lm])
  return (
    <LoadmapRoot lm={lm} theme={theme}>
      {model.title && <h2>{model.title}</h2>}
      <LoadBar lm={lm} />
      <Story lm={lm} />
      <Diagram lm={lm} onNodeClick={onNodeClick} selected={selected} />
      <div className="lm-side">
        <Verdict lm={lm} />
        <HeadroomChart lm={lm} />
        {model.scenarios.length > 1 && <Compare lm={lm} />}
        <Meters lm={lm} />
        <Limits lm={lm} />
        <Controls lm={lm} load={false} />
        <Assumptions lm={lm} extra={assumptions ? [...assumptions] : []} />
      </div>
    </LoadmapRoot>
  )
}
