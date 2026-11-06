---
'@loadmap/export': patch
---

A recording drew the same frame two ways on Linux Chromium once in a while: hinted text at a fractional scale (the
camera flying in) came out heavier or lighter depending on what the browser had drawn before. The board's copy now
draws its text unhinted (`text-rendering="geometricPrecision"`), so the same options give the same file again.
