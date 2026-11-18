---
'@loadmap/editor': minor
---

⌘S (Ctrl+S, with or without Shift) in the editor never opens the browser's Save Page. With the new `onSave` prop the
page saves every file of the definition (a branch, a file of its own); without it the bar says what keeps the text:
"Kept as you type" when the page keeps a draft, or that it keeps no copy and Share does. View → Keyboard shortcuts
lists the key. The docs' editor page takes the key wherever the focus is.
