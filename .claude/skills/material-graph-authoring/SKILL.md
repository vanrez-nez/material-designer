---
name: material-graph-authoring
description: >-
  Author, edit, and debug procedural PBR materials for the node-graph material system
  that compiles to a WebGPU/TSL Principled BSDF material. Use this
  whenever the task involves creating or modifying a material as a
  MaterialGraphDocument (nodes + edges JSON), wiring PBR channels (baseColor,
  roughness, metallic, normal, height, AO, emission), choosing or combining nodes
  (Noise/Tileable Noise, Voronoi, Domain Warp, Height Blend, Color Ramp, Normal
  From Height, Principled BSDF, …), making a material tile seamlessly, or baking a
  material to channel textures and evaluating the result. Trigger on any mention of
  "material graph", "material editor", "author a material / preset", "PBR material",
  "node material", "bake channels", or a request to build a specific surface (bark,
  brick, rusted metal, cracked clay, …) even if the word "skill" is never used.
---

# Material graph authoring

You are authoring a **procedural PBR material** as a `MaterialGraphDocument` — a
graph of nodes and edges that compiles to a single WebGPU/TSL Principled BSDF and
bakes to per-channel textures. The node set is a standard procedural shader-node model
(pattern/noise sources, converters and blends, a Principled BSDF surface). Full node
and bake references are bundled (see [Reference files](#reference-files));
this body is the *method* — how to build a material that reads as a real surface
rather than plausible-looking noise.

## The one idea that governs everything

**A material is a causal model of a surface's physical history, not a bundle of
independent channels.** `baseColor`, `roughness`, `metallic`, `normal`, `height`,
and `AO` are correlated *projections of the same underlying structure*. A scratch
lowers height, tilts the normal, dulls or brightens albedo, and changes roughness —
all at once. If you author each channel from a separate node chain, they decorrelate
and the surface instantly reads as CG.

So invert the naive order. Build a small number of **structural grayscale fields
first** (the "story": where is the rust, the wear, the grout, the moss), then
**derive every channel from those shared fields.** The fields are the source of
truth; channels are downstream. In this editor that means: reuse the same field
node into multiple channel paths (or a **Group** output) rather than duplicating a
noise chain per channel — reuse *guarantees* correlation.

### Height is the master field

One grayscale field usually dominates: **height**. It is generative because you can
differentiate it into most of the others:

- **Normal** = gradient of height → `Normal From Height` node. Drive it from the
  *same* height that feeds parallax, so relief and lighting agree.
- **AO** = occlusion of height → cavities read dark. Derive it from the height
  field, don't author it independently.
- **Curvature / edge masks** — convex edges (where paint chips, metal shines
  through) vs concave cavities (where dirt settles) are the two most useful wear
  masks, and both come out of height. `Voronoi: distance-to-edge`, height gradients,
  and `Levels` on a blurred-vs-sharp height difference approximate them.

If height is your master field, a large part of authoring is: build one convincing
height field, then fan it out.

## Authoring workflow

Work in this order. Each step is cheap to get right early and expensive to retrofit.

1. **Model the physical story before touching a node.** Name the substrate and the
   processes that acted on it (oxidation, abrasion, deposition, biological growth,
   thermal cycling). Each process becomes one masked layer. The graph is that
   history read left-to-right. If you can't state the story in a sentence, you're
   not ready to wire nodes.

2. **Build structure in grayscale first.** Get the height and the layer masks right
   as fields before any color. If the surface doesn't read at low frequency in
   grayscale, no gradient or grain will save it. Block big forms, then mid detail,
   then micro — coarse-to-fine, never uniform high-frequency everywhere (reads as
   noise) and never flat (reads as fake).

3. **Warp the domain for anything organic.** Straight noise looks synthetic;
   `Domain Warp` (or `Tileable Warp` inside a tiling chain) perturbs coordinates and
   introduces the flow and correlation that additive blending can't. This is the
   highest-leverage single operation for realism.

4. **Derive channels from the shared structure.** Fan the master height/masks into
   channels: `Normal From Height` for normal, height→AO, height-level and
   curvature masks to modulate roughness and albedo. Layer materials with
   `Height Blend` (picks the taller surface within a transition band) rather than a
   plain `mix` — deposition reads as physical, not as a crossfade.

5. **Color last, from grayscale.** Route structural fields through `Color Ramp` /
   gradient lookups. Keeping structure in grayscale and mapping to palette last
   means the same structure yields many materials by swapping the ramp.

6. **Keep it tileable by construction.** Prefer `Tileable Noise` + `Tileable Warp`
   for anything that will bake. Remember the domain split: **live** evaluates over
   3D world position (inherently seamless); **baked** renders a 2D UV slice where a
   world-domain look can seam. Author for the backend you will ship.

7. **Expose a low-dimensional semantic control surface.** Wrap reusable
   sub-networks in **Groups** with a clean typed interface exposing a few meaningful
   knobs ("age", "wetness", "tile size") that internally drive many params
   coherently — not 40 raw sliders. Groups also give you bake-decomposition
   boundaries for free.

## Wire the Principled BSDF deliberately

Every graph terminates at one `Principled BSDF` → `Material Output`. Watch the
silent failure: **only *connected* channel inputs are baked; unconnected inputs
fall back to the node's slider value.** Forgetting to wire `normal`, `height`, or
`ambient occlusion` doesn't error — it just silently produces a flat surface. Before
baking, confirm every channel the physical story needs is actually wired in.

## The verification loop is the spine of this skill

**A material is invisible in JSON.** You cannot judge it by reading the document —
you must bake it and *look*. Never hand back an unbaked material as "done." After
authoring:

1. **Bake** the document (see `references/baking.md`). For agent/headless use the
   `/export-bake` POST route — it requires a `/export-bake` worker tab open in a
   real browser (WebGPU only runs in-browser). **Do not use Playwright** for baking;
   the path depends on the live WebGPU runtime. In a dev app session, `__bakeMaterialTask`
   is equivalent.

2. **Open the outputs and inspect them.** The bake writes channel PNGs and one
   render per lighting profile under `bake/<name>/`. Each profile exists to expose a
   specific failure, so read them for that:
   - `renders/normals.png` — raking light on relief. Is the mesostructure present,
     or did you forget to wire the normal?
   - `renders/ao.png` — ambient-dominant. Do cavities darken, or is AO missing/uniform?
   - `renders/metallic.png` — IBL environment. Does metal read reflective and
     dielectric stay matte? (A metallic mask baked wrong reads as black.)
   - `renders/standard.png` — overall read under balanced key+fill.
   - `renders/tiled-2x2.png` — seam check. Visible grid lines mean the material
     isn't tiling (world-domain node baked to UV, or `tile` too small for the feature).

3. **Critique against the physical story, then iterate.** Does what you see match
   the surface you set out to build? Name the specific gap (flat where it should
   have relief, decorrelated where a scratch should touch four channels, seams,
   muddy value structure) and go fix that node — don't rebuild blindly. Repeat
   bake → look → critique until it holds up across all profiles.

## Optimizing the graph (THREE.js consumption)

The graph compiles to a THREE.js WebGPU node material (`MeshPhysicalNodeMaterial`),
and **cost lives in a completely different place depending on the backend** — so
decide which you ship *before* optimizing, because the two pull in opposite
directions. Conflating them is the central trap.

- **offline (default, what presets ship):** the graph is baked to textures; the mesh
  then just samples them (triplanar + parallax) with stock PBR. Runtime cost is a few
  texture fetches, **constant regardless of graph complexity**. Cost moves to *bake
  time* and *VRAM* (output resolution × channel count). Here, node count is nearly
  free at runtime — optimize bake time and texture memory, not graph size.
- **live:** the entire node graph runs per-fragment over world position every frame.
  Now graph complexity *is* the runtime cost and the browser's shader-size limit bites
  directly. Use live only when you specifically need world-space seamlessness or
  debugging; if you want cheap runtime, bake and ship textures.

The levers, in priority order:

1. **Reuse one master field into many channels — it's free.** The compiler builds
   each node exactly once and shares its output by reference to every consumer. Fan-out
   costs nothing; duplicating a subgraph re-evaluates it. So the correlation rule
   (route the master height/masks into normal, AO, roughness, color) is *also* the
   first optimization. Never copy-paste a noise chain per channel.

2. **Wrap expensive shared sub-networks in a Group.** Offline, each group output bakes
   to its own decomposition-cache texture — computed once, then sampled — instead of
   being inlined into the baseColor *and* roughness *and* normal shaders. Two payoffs:
   it keeps each per-channel shader under the shader-size limit (large graphs otherwise
   fail to compile at all), and it avoids recomputing shared work per channel. A
   multi-octave warped-noise block feeding several channels is the textbook candidate.

3. **Set `tileSize` on high-frequency detail noise.** It renders the noise into one
   small seamless tile (`tileSize²` texels) and repeats it, instead of evaluating every
   output texel — a large bake-time saving. Smaller tile = cheaper, more visible
   repeat. Use it for grain/detail where repetition reads as texture; leave the large
   defining forms un-tiled.

4. **Mind the param cost tiers if the material is tweaked live.** float/color/vec3/curve
   params compile to uniforms (edit `.value`, no recompile); bool/select/int like
   `octaves`, `noiseType`, `tileSize` are structural (edit → recompile); and some floats
   are `bakeStructural` (Voronoi `scale`→integer period, `randomness`, Tileable Noise
   `aspect`) forcing an offline re-bake. Expose knobs you want smoothly draggable as
   uniform-backed floats; changing octaves or noise type is a recompile, not a slider.

5. **Keep the height chain feeding `normal-from-height` lean.** It's a screen-space
   derivative, so offline supersamples its whole dependency path (renders it at a
   reference resolution, averages down) to stop fine height detail aliasing into
   speckle — that path costs more per texel. Sharing the single master height field
   (which you're doing for correlation anyway) keeps this to one supersampled chain.

6. **The real runtime cost of an offline material is the texture budget.** Choose
   output resolution and the connected-channel set to fit VRAM; that, not node count,
   is what the mesh pays for.

## Node selection cheatsheet

Full reference in `references/node-reference.md`. Fast mapping from intent to node:

- **Base fields / grain** → `Noise (FBM)`, `Tileable Noise` (bakeable, seamless).
- **Cells, stones, cracks, scales** → `Voronoi` (F1 = cells, distance-to-edge =
  cracks/grout, F2−F1 = scales; feature changes the outputs).
- **Bricks / planks / cobbles** → `Tile Generator` (a grid; unrelated to the `tile`
  perf param on Tileable Noise).
- **Scattered stamps** → `Scatter` → feed its per-cell `coord` into `Shape`.
- **Reshape a field's value distribution** → `Levels / Remap`, `Math` (contrast,
  smooth-min, etc.), `Clamp`.
- **Grayscale → color** → `Color Ramp`; combine layers → `Blend` (mix/multiply/
  screen/add, gated by mask×opacity).
- **Height → normal** → `Normal From Height`. **Decode an existing normal-map
  color** → `Normal Map`. Don't confuse them.
- **Layer two surfaces by elevation** → `Height Blend`. **Blend two whole
  materials** → `Mix Shader`.
- **Organic distortion** → `Domain Warp` / `Tileable Warp`.

## Watch these confusions (they cost bake time)

- `scale` (the look) vs `tile` (a perf optimization: a seamless block stamped N×,
  more repetition = cheaper) vs `output res` (baked pixel size) — three independent
  "size" settings. Only `Tileable Noise` has `tile`.
- Live (world domain) vs baked (UV slice): the same node can look different, and
  angular world-domain nodes (e.g. `anisotropic-stripes`) can seam when baked.
- Structural (`⟳`) params force a full re-bake; ordinary params live-update.

## Writing the MaterialGraphDocument

The document is `{ "version": 2, "nodes": [...], "edges": [...] }`. A node is
`{ id, type, params, enabled, position?, label?, subgraph? }`; an edge is
`{ fromNode, fromOutput, toNode, toInput }` addressing sockets **by key name**. Read
`references/document-schema.md` (verified against the runtime source) before authoring,
and pattern-match `examples/derived-skeleton.json` (a minimal one-field-fans-out
material) and `examples/rusty-metal.json` (a real preset) rather than inventing structure.

**The serialized param key is not the label in `node-reference.md`.** `tileable-noise`
stores `noiseType` / `octaves` / `gain` / `tileSize`, not "type/detail/roughness/tile";
`color-ramp` stores `colorA`/`colorB`. Authoring from the label list silently produces
ignored params that fall back to defaults. Use the key table in the schema doc, or copy
from a shipped preset. Terminal wiring is always `principled-bsdf.bsdf → material-output.surface`.

## Reference files

- `references/node-reference.md` — the concepts that affect authoring (scale/tile/res,
  live vs baked, PBR channels, groups) and the **full node reference** (every node, its
  sockets and params). Read for exact node capabilities and param ranges.
- `references/baking.md` — the bake server, `/export-bake` route and payload,
  lighting profiles, output layout, and dev-console handles. Read before baking.
- `references/document-schema.md` — the concrete `MaterialGraphDocument` JSON shape,
  verified against the runtime source: node/edge shape, socket kinds and coercion, the
  param-key-vs-label table, terminal wiring, and the backend model. Read before
  authoring any document.
- `examples/derived-skeleton.json` — minimal valid material where one field fans into
  color + roughness + normal + height (the correlation/optimization pattern in JSON).
- `examples/rusty-metal.json` — a full shipped preset for reference.
