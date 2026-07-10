# Pattern: Scattered stones — a stamp is a seed, not a surface

How to make any field of scattered discrete features (stones, gravel, debris, bark chips —
anything stamped by Scatter → Shape) read as *formed matter* instead of a grid of identical
CG bumps. Distilled from how material artists build rock fields in Substance Designer, and
validated against this runtime's bake pipeline.

---

## The principle

A stamped analytic profile is only a **seed**. Three independent forces turn it into a stone,
and every one of them must act *before* the normal map is derived:

1. **Per-instance form randomization.** Size and rotation are not enough — instances must
   differ in *outline* (seed-phased harmonics), *profile* (sharp vs flat), and *attitude*
   (tilted tops). Real fields break their own rules: some stones are slabs, some are round,
   some lie at angles.
2. **Erosion.** Real edges are chipped and melted, not mathematical. Distort each stamp's
   coordinate frame (a warp between Scatter and Shape) and/or undercut the body itself
   (Shape's `erode` — min-combined offset re-evaluations of its own silhouette).
3. **Slope variance everywhere.** Add masked fractal detail to the *height* before
   Normal From Height. This is not decoration — it is what prevents the cone artifact (below).
   No smooth surface should ever reach the normal derivation.

### Why smooth stamps become cones (the pinch)

The baked normal encoder bounds the tangent slope (a soft compression toward `MAX_SLOPE`,
protecting lighting from degenerate normals). A *smooth* steep feature — any small dome — has
slope ∝ 1/radius, so small instances sit entirely at the bound: **constant tilt with only the
direction varying, which is by definition the shading of a cone**, complete with radial facet
creases. No profile tweak fixes this; slope *variance* (forces 2 and 3) does, because a rough
surface has no constant-slope region. Corollary: never lower `MAX_SLOPE` to hide artifacts —
roughen the height instead.

### Why erosion lives inside Shape

The compiler builds each node's inputs once, over one shared coordinate — a downstream node can
never re-evaluate its upstream at shifted coordinates, so a general raster-style Slope Blur node
is not expressible. Only a node that *owns* its generating function can erode itself; that is
what Shape's `erode` does (a seed-rotated ring of min-taps over its own body).

---

## Minimal wiring (one size layer; repeat per scale, merge with `max`)

```txt
scatter.coord  →  domain-warp  →  shape.coord     ← erosion of the outline (force 2)
scatter.value  →  shape.seed                      ← REQUIRED: without it every instance is identical
scatter.value  →  levels (≈0.4–1) → math:multiply ← per-stone elevation …
shape.height   ————————————————————↗                … multiplied into the height
```

Then, once, after merging the layers:

```txt
merged = max(layerA, layerB, …)                   ← max, never add (added domes stack into spikes)
master = merged + tileable-noise × rockMask × ~0.1 ← force 3: slope variance before normals
master → normal-from-height → normal;  master → height (and drive color/roughness from the same masks)
```

Shape's per-seed form params (force 1): `tilt` ≈ 0.3–0.5, `formRandom` ≈ 0.6–0.8,
`erode` ≈ 0.5 **with `erode taps` switched on** (structural, default off — each tap re-evaluates the
whole silhouette, ~5× shader cost, so it's an explicit opt-in), plus `irregularity` for blobs. Mix
layers of different `shape` types (low-`dome` polygons = slabs; high-`irregularity` blobs = cobbles).

---

## Failure modes (each one was hit while deriving this)

1. **All stones identical** → `scatter.value → shape.seed` is missing.
2. **Everything liquefies into swirls** → warp amount too large for the layer's cell size.
   Keep a pre-scatter tileable-warp ≲ ⅓ of a cell (cell = 1/density); a warp *between* scatter
   and shape works in local units — keep it ≲ 0.3.
3. **Stones vanish** → the coord fed to Shape was offset/translated (e.g. by `value`) — that
   *moves the silhouette*, it doesn't decorrelate the warp. Rotation (`rotRandom 1`) already
   decorrelates instances; don't offset.
4. **Cone-tipped stones** → a smooth height reached Normal From Height (see the principle).
   Check that masked detail noise is added to the *master height*, not just to baseColor.
5. **Spikes where stones overlap** → layers were `add`ed. Merge with `max` / `smooth-max`.
6. **Cone at every cell center from the start** → the body was built from Voronoi F1
   (its distance field has a cusp per cell). F1 is for masks/color, never for stone bodies.
7. **Editing feels jammed (seconds per slider tick)** → the param being dragged is an
   int/select (structural → full pipeline recompile). All the params this pattern tunes are
   float uniforms by design; scatter `density` and shape `erode taps` are the structural ones —
   set them, don't drag them.
8. **Everything bakes ~5× slower than other materials** → `erode taps` is on for every layer.
   Each tap re-evaluates the whole silhouette in every consumer shader; enable it only on the
   layers where chips are actually visible, and confirm with `profile_nodes` / `__profileNodes()`
   (per-node isolated subtree timings) rather than guessing.

---

## Verify like this (not by staring at JSON)

- `normals` profile render at scale 3–4: raking light shows any cone tip or radial creases.
- A zoomed crop of the baked **normal** channel over the *smallest* stones: every stone should
  be a multi-hued faceted chunk; a pale disc with a radial fan is the pinch.
- Iso-contours (`fract(height × 8)` → baseColor) read the height data directly: rings that
  widen toward a center = rounded body; equal-width rings = cone in the data itself.

Reference implementation: saved version "Scree probe — eroded/tilted rocks". Sibling doc:
[masks.md](./masks.md) for gating content by fields.
