# @loadmap/export

PNG, SVG, GIF, WebM and MP4 of a [loadmap](https://jaim3r0jas.github.io/loadmap/), made frame by frame on a fixed
clock: the same options give the same file, byte for byte.

```ts
import { download, recordVideo } from '@loadmap/export'

const gif = await recordVideo(handle, {
  format: 'gif',
  seconds: 6,
  caption: true,
  script: [{ at: 2, set: { load: 30 } }],
})
download(gif, 'shop.gif')
```

`handle` is the `ref` of a `<Loadmap>`. `expose(handle)` lets `loadmap record` (from `@loadmap/cli`) drive the page
from the command line. MIT.
