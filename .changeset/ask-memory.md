---
'@loadmap/dsl': minor
'@loadmap/editor': minor
---

The Ask panel's conversations stay across reloads: `assist.conversations` (a `ConversationStore`) keeps them by a
scope the page names, at most 20 a scope and never a proposal. A model with a small window gets what fits:
`createAssistant` takes `window` and `smallReference`, reads the short reference under 64 000 tokens, sends the first
question with the newest turns, keeps an answer to a quarter of the window, and says so with a `trimmed` event; the
Ollama and LM Studio presets give a `window` of 32 000. `assist.smallReference` passes the short reference to the panel.

Docs: /assistant/#a-conversation
