---
'@loadmap/layout': minor
'@loadmap/dsl': minor
'@loadmap/react': minor
---

The boxes nothing feeds stand first along the flow, and a sink or store that feeds nothing stands last. Tiers cut the
diagram into bands across the flow (edge, services, data): `tier edge "Edge"` declares one, in the order the flow
meets them, and `tier: edge` puts a box in it (`tiers: { edge: { label: 'Edge' } }` in the view and `tier: 'edge'`
on a box in TypeScript). A box without a tier stands in the tier of the boxes that feed it. Each tier is a band behind
its boxes, every other one shaded, with its label in the margin before them: across the top running right, up the
left side running down and on a phone. `Scene.tiers` holds the bands; `collisions()` checks their labels too.
