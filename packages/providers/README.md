# @loadmap/providers

Reads measured data from the metrics stores a team already runs into a **snapshot**: the file a loadmap model reads
(`fromSnapshot` in `@loadmap/core/measure`). Nothing in a definition or a shared link fetches anything; a pull is an
explicit action, and the address and the credentials come from the environment, never from the text.

`loadmap pull x.loadmap` (in `@loadmap/cli`) is the usual way in. In code:

```ts
import { compile } from '@loadmap/dsl'
import { providersFromEnv, pull } from '@loadmap/providers'

const { measures } = compile(source)
const snapshot = await pull(measures, {
  from: '2026-11-01T00:00:00Z',
  to: '2026-11-08T00:00:00Z',
  step: 300,
  fetched: new Date().toISOString(),
  providers: providersFromEnv(process.env), // LOADMAP_PROMETHEUS_URL, LOADMAP_PROMETHEUS_TOKEN
})
```

A provider is one adapter, `{ id, read({ query, from, to, step }) }`, that answers with the points or with why not:
an error is data, so one failing query leaves that measurement missing and the model on the definition's own value.
`prometheus({ url, token })` reads `/api/v1/query_range`; a query must give one series. MIT.
