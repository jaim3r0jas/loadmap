---
'@loadmap/core': minor
'@loadmap/react': minor
---

The board plays a moment's way up. Pressing a preset's mark on the load bar, for a preset with a ramp, cold caches or
pods that take time to be ready, walks its moment at the sim's speed: the load climbs, the pods the autoscaler wants are
drawn dashed until they are ready, a cold cache warms, then the preset holds. Any other change stops it. The walk and
its playing load only when such a preset is pressed. Each step of `moment()` carries what it set beside the load
(`set`), for a host that plays it its own way.

Docs: /language/controls/#presets
