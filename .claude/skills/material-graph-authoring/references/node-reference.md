# Material node & concept reference

A material is a node graph that compiles to a WebGPU/TSL material. Every graph flows into a single
**Principled BSDF** (or **Emission**) shader, which feeds the one **Material Output** node; from there the
material is evaluated **live** or **baked** into per-channel PBR textures.

This reference covers the concepts that affect authoring and every node's sockets and params. For the
document JSON shape see **[document-schema.md](./document-schema.md)**; for baking, render profiles, and
export see **[baking.md](./baking.md)**.

Contents:

- [Concepts](#concepts)
  - [Scale vs Tile vs Output Resolution](#scale-vs-tile-vs-output-resolution)
  - [Live vs offline (baked)](#live-vs-offline-baked)
  - [PBR channels and the output target](#pbr-channels-and-the-output-target)
  - [Groups — what and when](#groups--what-and-when)
- [Node reference](#node-reference)
  - [Texture](#texture)
  - [Vector](#vector)
  - [Converter](#converter)
  - [Color](#color)
  - [Input](#input)
  - [Shader](#shader)
  - [Output](#output)
  - [Group](#group)

---

## Concepts

### Scale vs Tile vs Output Resolution

Three different "size" settings are easy to confuse. They are independent:

| Setting | Where | What it controls |
|---|---|---|
| `scale` (per node) | node params, e.g. Tileable Noise | How many periods/features the pattern packs across the UV — the **look**. |
| `tile` (per node) | Tileable Noise only | An **optimization**: bake a small seamless block once and repeat it. Doesn't change the look. |
| Output res | Material Output node | The **pixel size** of the baked channel textures (128–4096, default 1024). |
| `world / tile`, `tiling` | Preview panel | How the finished material is projected/repeated onto the demo mesh. **Viewer-only, never baked.** |

**What `tile = 512` means.** The `tile` param on a Tileable Noise node (`off / 64 / 128 / 256 / 512`) does
**not** set the texture size. It renders the noise into a single **512×512 seamless block** at full pixel
density, then stamps that block edge-to-edge to fill the whole output texture. The repeat count is:

```txt
repeat = outputResolution ÷ tile        (rounded; clamped so each tile keeps ≥ 1 period)
```

So a **1024px** output with `tile = 512` is a 1024×1024 texture containing a **2×2** grid of one seamless
block; `tile = 256` gives a 4×4 grid. Feature size and crispness are **identical** to a full render — the
node divides its period by `repeat` so the pattern lines up — the only visible difference is that the
pattern repeats. The payoff is compute: only `tile²` unique texels are ever evaluated instead of
`outputResolution²`. `off` renders the full grid (no repetition, most expensive). **Smaller tile = cheaper,
but more visible repetition.**

Seamlessness comes from the noise being wrapped on an **integer lattice** (cell `N` equals cell `0`) plus
render targets using `RepeatWrapping` — not from any edge blending. The repeat count is resolved from
`outputResolution` once, so **the amount of tiling looks the same in the live preview and the export**, even
though the on-screen bake may use a smaller pixel size for editing speed (the live surface bakes at
`outputResolution` snapped to a multiple of 64).

> Two things people mix up: only **Tileable Noise** has a `tile` param — the **Shape** node does not. And the
> separate **Tile Generator** node is unrelated to `tile`; it draws brick/plank/cobblestone grids
> (`columns` / `rows` / `gap` / …).

### Live vs offline (baked)

The graph compiles two ways:

- **Offline (default)** — each connected channel is baked into a 2D texture over the UV slice, and the
  surface samples those textures (with triplanar projection and parallax). This is where `tile`, group
  caches, and channel baking apply.
- **Live** — the procedural material is evaluated directly over 3D **world position**, which is inherently
  seamless (no tiling needed).

Because the domain differs (2D UV vs 3D world), a node authored to look right in one can behave differently
in the other — e.g. a world-domain look can show seams when baked as a flat 2D tile. The Tileable Noise
types are specifically authored to bake seamless in the offline backend.

### PBR channels and the output target

The baker renders these channels:

| Channel | Encoding | Notes |
|---|---|---|
| `baseColor` | sRGB | Presented as **Albedo / Diffuse** |
| `emission` | sRGB | Emitted color × strength |
| `roughness` | linear | |
| `metallic` | linear | |
| `ambientOcclusion` | linear | |
| `normal` | linear | Tangent-space normal |
| `height` | linear | Not a lit channel — drives **parallax** (a UV offset), baked to its own target |

The graph doesn't bake arbitrary nodes directly. A **Principled BSDF** node gathers typed inputs
(base color, metallic, roughness, normal, height, AO, emission, …), packs them into a material *bundle*, and
its single green output feeds the **Material Output**. The compiler unpacks that bundle onto the physical
material. **Only connected channels are baked** — an unconnected input falls back to the node's slider
value, and channels like normal/height/AO simply aren't produced if nothing is wired in.

The **output target** is that set of per-channel textures, allocated at the Material Output's **output
resolution**. To render or export them to files, see **[baking.md](./baking.md)** — its
[payload reference](./baking.md#payload-reference) documents the `channels` and `size` options, the
[output layout](./baking.md#output-layout) shows where files land, and `tiled-2x2.png` is a seam check.

### Groups — what and when

A **group** is a node that owns a nested subgraph — a reusable sub-network behind a typed interface. Inside the
group, two boundary nodes mirror its interface:

- **Group Input** — its *outputs* are the values passed *into* the group from the parent.
- **Group Output** — its *inputs* become the group's *outputs* back to the parent.

A group node stores its nested document on `subgraph`; the `group-input` / `group-output` boundary nodes
carry the interface, and their `ports` list the exposed sockets. A new group starts as a single `value`
float passing straight through.

Create a group to:

- **Encapsulate** a reusable sub-network behind a clean, typed interface (e.g. a "weathering" or
  "brick-with-mortar" block) that exposes only the sockets that matter.
- **Reuse** the same computation with different inputs (each instance is seeded with its own external
  inputs).

As a bonus, a group is also a **bake-decomposition boundary**: each group output is baked into its own
intermediate cache texture, which keeps individual channel shaders small (avoiding browser shader-size
limits) and lets derivative paths like Normal From Height supersample cleanly. Cache resolution is handled
automatically — it is **not** a group setting.

---

## Node reference

Nodes are grouped by category below. Parameter notation is
`label — type, range/options, default`. A **⟳** marks a *structural* parameter: editing it forces a full
offline re-bake rather than a live uniform update.

Most texture/vector nodes accept an optional `coord` (vector) input; when it's unconnected they use the
global surface coordinate.

### Texture

| Node (`type`) | Inputs | Outputs | Parameters |
|---|---|---|---|
| Noise (FBM) `fbm` | coord | field | scale — 0.1–8, 1.2 · detail — int 0–15, 4 · lacunarity — 1.5–3, 2 · roughness — 0–1, 0.5 |
| Tileable Noise `tileable-noise` | coord | field (+ vector when type = curl) | type — select, `perlin-fbm` · scale — 1–128, 5 · aspect — 1–8, 1 · detail — int 1–8, 4 · roughness — 0–1, 0.5 · lacunarity ⟳ — 2–8, 2 · anti-alias — 0–1, 1 · gabor freq — 0–16, 2 · gabor aniso — 0–1, 1 · gabor angle — 0–6.28, 0.785 · **tile** — `off/64/128/256/512`, off |
| Screen Noise `screen-noise` | coord | field | type — `blue/hilbert-blue/ign/golden-ign/scratches`, blue · resolution — 16–2048, 512 |
| Voronoi `voronoi` | coord | distance, color, position (or distance + random) | scale — 0.1–64, 1 · randomness — 0–1, 1 · metric — `euclidean/manhattan/chebychev/minkowski`, euclidean · feature — `f1/f2/smooth-f1/distance-to-edge`, f1 · exponent — 0.1–8, 2 · smoothness — 0–1, 0.25 · relax — int 0–5, 0 |
| Checker `checker` | coord, color1, color2 | color, fac | color1 — `#c4201e` · color2 — `#18b6b6` · scale — 0.5–32, 4 |
| Tile Generator `tile` | coord | mask, value | lattice — `square/hex`, square · columns — int 1–32, 6 · rows — int 1–64, 12 · row offset — 0–1, 0.5 · offset every — int 1–6, 2 · gap — 0–0.08, 0.012 · roundness — 0–1, 0.05 · edge soft — 0–0.05, 0.004 · size rand — 0–1, 0 · pos rand — 0–1, 0 · rot rand — 0–1, 0 |
| Scatter `scatter` | coord | coord, value, size | density — int 1–48, 10 · amount — 0–1, 0.5 · radius — 0.05–1, 0.4 · size rand — 0–1, 0.6 · pos rand — 0–1, 0.85 · rot rand — 0–1, 1 |
| Shape `shape` | coord, seed | mask, height | shape — `blob/polygon`, blob · sides — int 3–12, 6 · irregularity — 0–1, 0.6 · dome — 0.2–3, 0.6 · edge soft — 0.002–0.3, 0.04 · tilt — 0–1, 0 · form rand — 0–1, 0 · erode — 0–1, 0 · erode taps ⟳ — `off/4`, off |
| Gradient `gradient` | coord | field | scale — 0.1–8, 1 · type — `linear/quadratic/easing/diagonal/radial/quadratic-sphere/sphere`, linear |
| Wave `wave` | coord | field | scale ⟳ — 0.1–8, 1 · type — `bands/rings`, bands · direction — `x/y/z/diagonal`, x · profile — `sine/saw/triangle`, sine · phase — 0–20, 0 · distortion ⟳ — 0–10, 0 · detail — int 0–8, 2 · detail scale ⟳ — 0–8, 1 · detail rough — 0–1, 0.5 |
| Anisotropic Stripes `anisotropic-stripes` | coord | field | count — 1–64, 22 · sharpness — 0.2–8, 2.2 · waviness — 0–2, 0.18 · contrast — 0–1, 1 |

> **Tileable Noise** shows different controls per `type`: cellular/gabor types hide `aspect`; gabor shows
> only its gabor controls + `tile`; curl adds a second **vector** output and hides the fBm controls. Use
> **`tile`** to trade a visible repeat for cheaper bakes (see
> [Scale vs Tile vs Output Resolution](#scale-vs-tile-vs-output-resolution)).
>
> **Scatter → Shape** are a pair: Scatter distributes points and emits a per-cell local `coord` (+ `value`,
> `size`); feed that `coord` into a **Shape** node to stamp a silhouette (mask + domed height) at each point.
> Wire `Scatter.value → Shape.seed` or every instance is the identical outline. For ROCK-like stamps, the
> per-seed form params matter: `tilt` (stones lying at angles), `form rand` (sharp AND flat stones from one
> layer), and `erode` (min-tap self-erosion — chipped/melted outlines, the slope-blur equivalent; shape
> erodes ITSELF because the compiler can't re-evaluate an arbitrary upstream field at offset coords).
> Erosion must be enabled via **`erode taps`** (structural ⟳, default off): each tap re-evaluates the whole
> silhouette, so it multiplies shader size and pipeline-compile time ~5× — pay it only where it shows. A
> `domain-warp` between Scatter and Shape distorts each outline organically (rotation decorrelates
> instances); keep its amount ≲ 0.3 in local units.
>
> **Voronoi** changes its outputs with `feature`: F1/F2/smooth-F1 give `distance`/`color`/`position`;
> `distance-to-edge` gives `distance`/`random`. `exponent` applies only to the Minkowski metric,
> `smoothness` only to smooth-F1, `relax` (Lloyd relaxation) only to distance-to-edge.

### Vector

| Node (`type`) | Inputs | Outputs | Parameters |
|---|---|---|---|
| Domain Warp `domain-warp` | coord | coord | amount — 0–2, 0.3 · scale — 0.1–8, 1 |
| Tileable Warp `tileable-warp` | coord | coord | amount — 0–1, 0.15 · scale — int 1–64, 4 |
| Vector Math `vector-math` | A, B | vector (or value for dot/distance/length) | op — select (add, subtract, multiply, …, normalize, sine, …), add · scale — −8–8, 1 |
| Normal From Height `normal-from-height` | height | normal | strength — 0–2, 0.2 |
| Normal Map `normal-map` | color, strength | normal | strength — 0–4, 1 |
| Mapping `mapping` | vector | vector | type — `point/texture/vector/normal`, point · location — vec3, (0,0,0) · rotation — vec3 radians, (0,0,0) · scale — vec3, (1,1,1) |

> **Domain Warp** is the general (world-domain) warp; **Tileable Warp** is its seamless counterpart for use
> inside a tiling chain. **Normal From Height** derives a normal from a scalar height field (bump live /
> encoded tangent-space normal when baked); **Normal Map** decodes an existing normal-map *color* through the
> surface TBN.

### Converter

| Node (`type`) | Inputs | Outputs | Parameters |
|---|---|---|---|
| Math `math` | A, B (+ C for ternary ops) | field | op — select (add … mix, ~41 ops), mix · factor / B — 0–1, 0.5 · C — 0–1, 0.5 |
| Levels / Remap `levels` | field | field | out min — 0–1, 0 · out max — 0–1, 1 · invert — bool, false |
| Color Ramp `color-ramp` | field | color | low — `#3f2d1e` · high — `#8a6a4a` · low stop — 0–1, 0.3 · high stop — 0–1, 0.75 |
| Height Blend `height-blend` | Height A, Height B, Breakup | fac | transition — 0–1, 0.5 · width — 0.01–1, 0.25 · breakup amt — 0–1, 0 |
| Luminance `luminance` | color | field | — |
| Split Channels `split-channels` | color | r, g, b | — |
| Combine Channels `combine-channels` | r, g, b | color | — |
| Clamp `clamp` | Value, Min, Max | field | mode — `minmax/range`, minmax · min — −10–10, 0 · max — −10–10, 1 |
| Separate XYZ `separate-xyz` | vector | x, y, z | — |
| Combine XYZ `combine-xyz` | x, y, z | vector | x — −10–10, 0 · y — −10–10, 0 · z — −10–10, 0 |

> **Math** picks its input sockets from the operation: unary ops show only `A`, ternary ops (multiply-add,
> wrap, smooth-min…) add `C`, and the socket labels change per op (e.g. power → Base/Exponent). `factor / B`
> stands in for the second input and is the blend amount for `mix`. **Color Ramp** is a two-stop field→color
> lookup (feed it a mask/field to colorize it).

### Color

| Node (`type`) | Inputs | Outputs | Parameters |
|---|---|---|---|
| Blend `blend` | base, over, mask | color | mode — `mix/multiply/screen/add`, mix · opacity — 0–1, 1 |
| Invert Color `invert` | Fac, Color | color | fac — 0–1, 1 |
| Bright / Contrast `bright-contrast` | Color, Bright, Contrast | color | bright — −1–1, 0 · contrast — −1–1, 0 |
| Hue / Saturation `hue-sat-val` | Color | color | hue — 0–1, 0.5 · saturation — 0–2, 1 · value — 0–2, 1 · fac — 0–1, 1 |
| RGB Curves `rgb-curves` | Fac, Color | color | fac — 0–1, 1 · curves — Combined + R/G/B tone curves, identity |

> **Blend** layers `base` under `over`, gated by `mask × opacity`. **RGB Curves** edits four tone curves
> (Combined + per-channel R/G/B).

### Input

| Node (`type`) | Inputs | Outputs | Parameters |
|---|---|---|---|
| Constant (Field) `constant-field` | — | field | value — 0–1, 0.5 |
| Constant (Color) `constant-color` | — | color | color — `#808080` |
| Texture Coordinate `tex-coordinate` | — | generated, uv, object, normal | — |

> In an offline bake, all Texture Coordinate outputs collapse to the UV slice.

### Shader

| Node (`type`) | Inputs | Outputs | Parameters |
|---|---|---|---|
| Principled BSDF `principled-bsdf` | base color, metallic, roughness, IOR, alpha, normal, height, ambient occlusion, coat weight, coat roughness, sheen weight, sheen roughness, transmission, emission color, emission strength | bsdf | base color — `#cccccc` · metallic — 0–1, 0 · roughness — 0–1, 0.5 · IOR — 1–2.5, 1.5 · alpha ⟳ — 0–1, 1 · coat weight — 0–1, 0 · coat rough — 0–1, 0.03 · sheen weight — 0–1, 0 · sheen rough — 0–1, 0.3 · transmission — 0–1, 0 · emission ⟳ — `#000000` · emission str — 0–10, 1 |
| Emission `emission` | Color, Strength | bsdf | color — `#ffffff` · strength — 0–10, 1 |
| Mix Shader `mix-shader` | Shader A, Shader B, Fac | shader | fac — 0–1, 0.5 |

> **Principled BSDF** is the main PBR surface — wire your generated maps into its inputs; anything left
> unconnected uses the slider value. `normal`, `height`, and `ambient occlusion` are input-only (no slider).
> **Mix Shader** blends two whole material bundles channel-by-channel by a single `Fac` (0 = A, 1 = B) — the
> way to combine two full materials (e.g. two Principled BSDFs) with a mask.

### Output

*Every graph has exactly one; it is never added or removed.*

| Node (`type`) | Inputs | Outputs | Parameters |
|---|---|---|---|
| Material Output `material-output` | Surface (shader) | — | output res — `128/256/512/1024/2048/4096`, 1024 |

> The terminal output node. It's a singleton, undeletable, and its **output res** sets
> the pixel size of the baked channel textures — see
> [Scale vs Tile vs Output Resolution](#scale-vs-tile-vs-output-resolution).

### Group

*The boundary nodes exist inside every group.*

| Node (`type`) | Role |
|---|---|
| Group `group` | A node instance that owns a nested subgraph; its ports come from the subgraph's interface. |
| Group Input `group-input` | Boundary inside the subgraph — its outputs are the group's external inputs. |
| Group Output `group-output` | Boundary inside the subgraph — its inputs are the group's external outputs. |

See [Groups — what and when](#groups--what-and-when) for group semantics.

---

## Baking and export

Rendering and exporting channel textures is a separate step — the bake server, the `/export-bake` route,
render profiles, and batch preset generation are documented in **[baking.md](./baking.md)**.

Only the recompile cost matters for authoring: a **⟳** (structural) param, or adding/removing a node or
rewiring an edge, forces a full offline re-bake; plain float/color param changes update live uniforms
without one.
