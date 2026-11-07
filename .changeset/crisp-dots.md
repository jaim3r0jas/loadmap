---
'@loadmap/react': patch
---

The dots are as sharp as the boxes on every board. A board that had its size before its first layout (a `<Diagram canvas>`, the editor's diagram) kept the canvas at the browser's 300 × 150 pixels and stretched it, so its dots were blurred to five or ten times their size; the canvas now follows its own size on the screen, in device pixels where the browser counts them, a canvas shown again and a screen of another density included. Screens above twice the pixel ratio get every pixel too, where the dots were drawn at two and stretched.
