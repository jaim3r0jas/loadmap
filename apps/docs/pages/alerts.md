# Alerts

Two flows on two topics that share three brokers: alerts on a pool of their own, served first at every hop, and
positions, which under backlog keep only the newest fix per user. A push broker fans both out to the people who
receive them. It compares today with a proposal (twice the position pods, a fourth push node), turns load into dates
with a growth rate, and the gateway's capacity is an estimate (± 30 %) until its load test is done.

**Try:** switch to **Proposed** · **▶ Play**: in the last step the push broker takes over · zoom into the brokers:
drag, pinch or Ctrl-scroll.

<div class="island" data-island="example" data-name="alerts" data-editor="../../editor/"></div>

**alerts.loadmap ↓** is the same model as text
([on GitHub](https://github.com/jaim3r0jas/loadmap/blob/main/examples/alerts/alerts.loadmap)). Open it in VS Code
with the loadmap extension for a live preview beside the text, or in Neovim or Helix:
[In your editor](/in-your-editor/).

## Keeping it true

`loadmap check alerts.loadmap` prints `alerts.loadmap: 2 expectations hold`, or fails the build that loses one:

```
@include(examples/alerts/alerts.loadmap, "expect ", "step ")
```
