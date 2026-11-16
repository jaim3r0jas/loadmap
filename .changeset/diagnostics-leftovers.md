---
'@loadmap/dsl': patch
---

Four diagnostics say one thing instead of several. `rate = 40` is one error, not also "flow needs rate"; a `"…"` text
carried onto the next line is one error at its first line, not three; a formula wrapped without parentheses says so
once, with the fix ("put the formula in ( … )"); and an expectation that rests on a demand that is no number (a
division by zero at the defaults) is inconclusive and says why, instead of a firm "holds up to 0×". A failure that a
component with a real demand shows by itself stays a failure.
