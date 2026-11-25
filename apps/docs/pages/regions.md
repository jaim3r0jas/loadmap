# Two regions

Users in Europe and in the US, each region sized for its own, behind one traffic router. The question it answers is
the one asked of any system in parts: if we lose a region, does the other one hold, and where does it break first?
Each region is a **subsystem**: a load balancer, the API, the line that takes orders (itself a subsystem: a topic and
its workers) and Postgres. The regions are written once, in a library, and each takes its own sizes, so the board
shows two copies of one design, framed and named. It opens with both regions closed, each as one box.

**Try:** read the overview first: each closed region says how busy the busiest part in it is, and wears the limit
when it is inside · open **Design** and set **Outage** to **the EU region out**: the US region wears the limit at 1×,
today's load · click the US region to open it, then click its frame to fly in, and the path over the board says where
you are · **▶ Story** walks the same way.

<div class="island" data-island="example" data-name="regions" data-editor="../../editor/"></div>

## Reading it

- **Closed, a region is one box.** Its colour is the worst part inside, its second line names the busiest one, and the
  limit's tag sits on it when the first limit is inside. A click opens it.
- **Open, a region is a frame** with its name; a frame's line turns the colour of the worst box inside once one is past
  its target. A click on the name closes it again, a click on the frame flies in, and **Whole diagram** flies out.
- **The two copies are told apart** by where they stand: the limits and the scenarios say "US region › Workers", the
  verdict "the workers in US region", while the box itself reads "Workers" in its frame.

## In several files

The model names every other file it needs in its head:

```loadmap
@include(examples/regions/regions.loadmap, "loadmap ", "title:")
```

`region.loadmap` is a library: one region, written once, with what each region decides as its inputs. Its orders line
is a subsystem from another library, `platform.loadmap`, the building blocks every team shares:

```loadmap
@include(examples/regions/region.loadmap, "subsystem region")
```

Each region is the library's subsystem with its own sizes and its own flows:

```loadmap
@include(examples/regions/regions.loadmap, "subsystem eu ", "users ->")
```

The story is a part (`regions.story.loadmap`), and `regions.even.loadmap` is a variant: the same model with the US
sized as the EU is. In the editor, **Edit in the editor** opens each file as a tab, with the subsystems each declares
listed under it. **regions.loadmap ↓** downloads the files written as one, as `loadmap bundle` writes them; the files
themselves are [on GitHub](https://github.com/jaim3r0jas/loadmap/tree/main/examples/regions).

## Keeping it true

`loadmap check regions.loadmap` prints `regions.loadmap: 3 expectations hold`, or fails the build that loses one:

```loadmap
@include(examples/regions/regions.loadmap, "expect ", "flow ")
```
