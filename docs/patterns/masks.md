# Pattern: Masks

A **mask** is a single `float` field in the range 0–1 that gates *where* one thing shows over
another. In this graph system a mask is never a special node type — it's just a field wired into a
`mask` / `Fac` input. Any node that emits a field (Noise, Voronoi, Gradient, Levels, **Height
Blend**, …) can be a mask source; any node that consumes one (`blend`, `mix-shader`, `math`) is a
mask *sink*. This doc documents the exact wiring we keep re-using, in a form you can rebuild from
scratch, because it is easy to get subtly wrong.

The canonical version of this pattern is **Height Blend → Blend**, colorized for inspection. That is
the graph documented below.

---

## What the pattern does

Split a surface into two interlocking regions along an **organic, feature-following border** (not a
straight crossfade), then blend two things across that border. Two independent noise fields describe
the two regions; a third noise breaks the border up so it looks natural; the result is a clean 0–1
mask that can drive *any* sink.

The render check for this graph is a red/blue sphere: red = region A, blue = region B. Those flat
colors are a **debug visualization of the mask itself** — you swap them for real content once the
border reads right (see [Colorize to inspect](#colorize-to-inspect-the-debug-red--blue)).

---

## The active graph (reproducible wiring)

Nine nodes. Rebuild it exactly like this:

| Label | `type` | Key params | Role |
|---|---|---|---|
| Noise A | `tileable-noise` | `scale 1`, perlin-fbm, octaves 3 | Region-A height field |
| Noise B | `tileable-noise` | `scale 5`, perlin-fbm, octaves 3 | Region-B height field |
| breakup noise | `tileable-noise` | `scale 18`, octaves 5 | Ragged-border driver (fine detail) |
| Mask: A/B split | `height-blend` | `transition 0.54`, `width 0`, `breakup 1` | **Mask source** → emits `fac` |
| (red) | `color-ramp` | `colorA/B #ff0000` | Debug content for region A |
| (blue) | `color-ramp` | `colorA/B #0000ff` | Debug content for region B |
| A/B blend | `blend` | `mode mix`, `opacity 1` | **Mask sink** — combines a/b by the mask |
| Principled | `shader-material` (physical) | `roughness 0.9` | Surface |
| Output | `material-output` | `2048` | Terminal |

**Edges** (output → input):

```txt
Noise A        field  →  height-blend.heightA
Noise B        field  →  height-blend.heightB
breakup noise  field  →  height-blend.breakup
height-blend   fac    →  blend.mask          ← the mask
red   color-ramp color →  blend.a
blue  color-ramp color →  blend.b
blend          color  →  principled.baseColor
principled     bsdf   →  output.surface
```

Read it left to right: three noises resolve to one `fac`; `fac` chooses between `a` and `b` at every
texel.

---

## The mask math

Height Blend does not average the two inputs — it *compares* them and returns which one wins, with a
soft edge:

```txt
d   = (heightB − heightA) + (2·transition − 1)      // relative height, biased by transition
d  += (breakup − 0.5) · breakupAmt                  // optional ragged perturbation of B
fac = smoothstep(−e, +e, d)      where e = max(width, fwidth(d))
```

What each control does, and why it matters when replicating:

- **`transition`** (0–1) slides the border. At `0.5` the two heights compete evenly; raising it lets
  B win first *where B's own height is high*, then spread — an interlocking border, not a dissolve.
  Our graph uses `0.54` (a hair toward B).
- **`width`** (0–1) is the soft-blend band. `width 0` is **not** degenerate: `build()` floors the
  band at `fwidth(d)` (one texel), giving a **crisp, anti-aliased** edge. Large `width` = a genuine
  soft gradient across the border. Our graph uses `0` → hard, clean split.
- **`breakup` amt** (0–1) perturbs B's height by the wired breakup field, centered at 0.5. **Default
  is `0`, i.e. no effect** — you must raise it *and* wire a field into the `breakup` input for ragged
  edges. Our graph uses `1` with a scale-18 / octaves-5 noise → the frayed coastline look.

---

## Why it usually breaks when replicated

These are the failure modes — check them in order when the mask doesn't come out right:

1. **`fac` never varies (flat mask).** Height A and Height B are too similar. They must be *different*
   fields — different `scale` (1 vs 5 here), or different noise character. Two identical noises give a
   constant `d` and a solid-color result.
2. **No ragged border.** `breakup amt` left at its `0` default, or nothing wired into the `breakup`
   input. Both are required — the param alone does nothing.
3. **Border too soft / too hard.** That's `width`, not `transition`. `width 0` = crisp; raise it for
   a gradient. Don't reach for `transition` to sharpen — `transition` moves the border, `width` sets
   its softness.
4. **Blend shows only one side.** On the `blend` sink, `opacity` must be `1` — the effective mask is
   `mask × opacity`. An opacity below 1 fades region A back in everywhere.
5. **Mask input polarity.** `blend` layers `a` under `b` gated by the mask: `fac = 0` shows `a`,
   `fac = 1` shows `b`. If the regions are swapped, either flip the two inputs or raise/lower
   `transition` — don't invert unless you mean to.
6. **Seams when baked.** Use **`tileable-noise`** (not `fbm`) for every mask-source field, and feed it
   raw UV — a Mapping rotate/scale *before* a tileable node reintroduces seams. See
   [graph.md](../graph.md) and the tileable-tiling notes.

---

## Colorize to inspect (the debug red / blue)

The two `color-ramp` nodes set to flat `#ff0000` / `#0000ff` exist **only to see the mask**. Routing
`fac`-driven flat colors to `baseColor` turns the border into a high-contrast map you can read at a
glance — red is A, blue is B — so you can tune `transition` / `width` / `breakup` before committing to
real content. Keep this scaffold in while dialing the mask; it is faster than reasoning about the raw
field.

You can also solo the Height Blend node (eye icon) to view `fac` directly as greyscale.

---

## Turning the mask into real output

Once the border reads right, replace the debug ramps with actual content. Two sinks:

- **Blend (per-channel).** Swap the flat color-ramps for real color sources (or feed `fac` into any
  channel's `math`/`levels` to modulate roughness, height, AO, …). This is the graph above. Use it to
  vary *one or a few channels* by the mask.
- **Mix Shader (whole materials).** Feed `fac` into `mix-shader.Fac` and wire two full **Principled
  BSDF** bundles into `Shader A` / `Shader B`. This blends *every* channel at once — the right choice
  when the two regions are genuinely different materials (e.g. tile vs gravel). Height Blend was
  authored with this sink in mind: as `transition` rises, B's high features poke through first, giving
  a physically plausible interlock.

The mask source (Height Blend + three noises) is identical in both cases — only the sink changes.

---

## Reuse checklist

- [ ] Two **different** fields into Height A / Height B (differ by scale or type).
- [ ] A **third** fine noise into `breakup`, **and** `breakup amt > 0`.
- [ ] `width 0` for a crisp edge, or raise it for a soft one — not `transition`.
- [ ] `transition` positions the border (~0.5 = even).
- [ ] Sink: `blend` with `opacity 1`, **or** `mix-shader` for full materials.
- [ ] All mask-source noises are `tileable-noise` on raw UV (seamless bakes).
- [ ] Debug-colorize (`fac` → flat colors) while tuning; swap for real content after.
