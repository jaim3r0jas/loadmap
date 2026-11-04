---

"@loadmap/core": minor
"@loadmap/sim": minor
"@loadmap/layout": minor
"@loadmap/react": minor
"@loadmap/export": minor
"@loadmap/dsl": minor
"@loadmap/editor": minor
"@loadmap/cli": minor
---

Building blocks: a cache stage (hits answered and sent back), an autoscaled workers pool (min, max, target; a pods
meter), a rate limiter (`limit` with a `configured` capacity) and retries that settle past capacity (`retry` with a
budget). `at.<stage>.<flow>` reads what reaches a stage, a component without a demand takes it, and four new
templates show each block.
