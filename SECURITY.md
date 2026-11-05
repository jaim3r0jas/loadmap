# Security

## Reporting a vulnerability

Please report it privately: **Security → Report a vulnerability** on
[github.com/jaim3r0jas/loadmap](https://github.com/jaim3r0jas/loadmap/security/advisories/new). Do not open a public
issue. The answer comes in the advisory; a fix ships as a new version of every `@loadmap/*` package, with the advisory
published and crediting you if you like.

Only the latest version gets fixes.

## What you can check

From 0.1.1 on, every `@loadmap/*` version on npm is published by this repository's `release` workflow through npm
trusted publishing, with provenance: `npm audit signatures` verifies it, and the package page on npmjs.com links the
exact commit and workflow run. Only a package's first version is published by hand, without provenance (0.1.0 and
0.0.0-stage of the packages so far); any other version without provenance did not come from here. The packages accept
no publish tokens.

`.loadmap` definitions and shared links are untrusted input: their formulas are parsed and run as closures over the
syntax tree, never through `eval` or `new Function`, and names resolve only to what the definition declares. A way
around that is a vulnerability.
