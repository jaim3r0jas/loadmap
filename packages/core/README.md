# @loadmap/core

The model behind [loadmap](https://jaim3r0jas.github.io/loadmap/), in plain TypeScript with no dependencies: params,
flows, components whose capacities say where they came from, limits as ranges, the verdict, scenarios, growth,
`compare()`, `headroom()` and `check()`. It runs in Node, so a test can hold a model to its headroom:

```ts
import { assertHolds } from '@loadmap/core'
import { shop } from './shop'

it('keeps its headroom', () => assertHolds(shop)) // throws, listing every failed expectation
```

`@loadmap/core/calibrate` fits `cost = a + b × rate` from measurements (`fitLinear`); `@loadmap/core/format` has the
number formats the verdict uses. Most pages install [`@loadmap/react`](https://www.npmjs.com/package/@loadmap/react),
which re-exports all of this. MIT.
