---
'@loadmap/dsl': minor
---

A formula reads an outage: `down.zone` is true while a part of the failure domain `zone` is out, so a formula says
what the outage changes beyond the members it takes (`hit: down.zone ? 60% : 90%`, `fails: down.zone ? 2% : 0%`). In a
definition with a domain, a box every flow passes that stands across none has the new `single-point` warning, and so
has a box across a domain with one member: with its part out none is left. Autocomplete
offers `down.<domain>` for each domain. From `loadmap 1.8`.

Docs: /language/building-blocks/#failure-domains
