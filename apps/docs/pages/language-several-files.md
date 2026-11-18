# Several files

@section(docs/dsl.md, "### Several files")

## One model in four files

A shop in several files, each whole: the model, a part of it, the library it imports and a variant. They are the
repository's `docs/multi-file/`, which the tests compile from each file.

`shop.loadmap`, the model: it includes its part and imports two names from the library.

```loadmap
@include(docs/multi-file/shop.loadmap)
```

`shop.story.loadmap`, a part: its statements are the model's.

```loadmap
@include(docs/multi-file/shop.story.loadmap)
```

`platform.loadmap`, a library: values, boxes and subsystems several models share, checked on its own.

```loadmap
@include(docs/multi-file/platform.loadmap)
```

`shop.big.loadmap`, a variant: the model with other values, writing only what differs.

```loadmap
@include(docs/multi-file/shop.big.loadmap)
```
