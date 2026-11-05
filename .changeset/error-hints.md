---
"@loadmap/dsl": patch
---

Two slips get one error with the fix instead of a puzzle. A box whose only component lines are optional ones
(`describe`, `name`, `short`, `plural`, `when`), with no demand, capacity or over, gets one error on that line
instead of three "the component needs …": for a plain-text `describe`, put it on the first line, `node users "Users"
"people on the shop"`. And `a -> b: { … }` says to drop the ":" before the block (a fan-out branch, that it takes its
copies after ":"), then checks the block's lines as usual.
