---
'@loadmap/editor': patch
---

Undo and redo of a rename that reached several files take it back, or make it again, in every one of them, from
whichever tab it is undone in. A file edited since keeps the name it has, and the editor says so.
