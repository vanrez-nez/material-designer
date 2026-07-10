# MaterialGraphDocument schema

Verified against `material-designer-runtime` (`src/graph/types.ts`, `document.ts`, the
node defs under `src/graph/nodes/`) and the shipped presets in
`material-designer/src/presets/`. This is authoritative; the human-facing labels in
`node-reference.md` are **not** the serialized keys — always use the keys here.

## Document

```jsonc
{
  "version": 2,                      // MATERIAL_DOCUMENT_VERSION; migrate() fills it in if absent
  "nodes": [ /* GraphNode[] */ ],
  "edges": [ /* GraphEdge[] */ ],
  "metadata": { "title": "..." },    // optional
  "ui": { /* editor view state */ }  // optional, cosmetic — omit when authoring
}
```

A document is a serializable, id-based **DAG**. The compiler topo-sorts it, resolves
the single `principled-bsdf` (or `emission`) feeding the terminal `material-output`,
and unpacks that bundle into a THREE.js `MeshPhysicalNodeMaterial` (live) or
texture-baked maps (offline). A document that fails to compile in the `live` backend
is rejected on load (`validate()` compiles it to check).

## GraphNode

```jsonc
{
  "id": "noise1",              // unique string; edges reference it
  "type": "tileable-noise",    // registry key (see node-reference.md node reference)
  "params": { "scale": 8 },    // keyed by PARAM KEY (below), not label; omitted params use defaults
  "position": { "x": 0, "y": -440 },  // optional; editor layout only, ignored by compiler
  "enabled": true,             // present on every shipped node
  "label": "base grain",       // optional cosmetic rename; never recompiles
  "ports": { "inputs": [], "outputs": [] },  // ONLY on group / group-input / group-output
  "subgraph": { /* MaterialGraphDocument */ }  // ONLY on a `group` node; compiled recursively
}
```

## GraphEdge

```jsonc
{ "fromNode": "noise1", "fromOutput": "field", "toNode": "ramp1", "toInput": "field" }
```

Sockets are addressed **by key name**, not index. Each input takes at most one edge.
Cross-kind edges are coerced per the matrix below; unlisted pairs are rejected.

## Socket kinds and coercion

Four `PortKind`s: `float` (grey — scalars: height, masks, roughness, AO, metallic),
`vector` (blue — coords, warp offsets, normals), `color` (yellow — sRGB base/emission),
`shader` (green — the BSDF closure marker; only `principled-bsdf`/`emission` emit it,
only `material-output` consumes it, never coerces).

Coercion (output kind → input kind): float→vector/color broadcasts; vector→float
averages; color→float is luminance; vector↔color reinterpret componentwise; same-kind
is identity. `shader` connects only to `shader`.

## Param keys ≠ labels (the trap)

The docs list labels; the document stores keys. Confirmed mismatches:

| Node | Param KEY (use this) | Label in docs |
|---|---|---|
| `tileable-noise` | `noiseType` | type |
| `tileable-noise` | `octaves` | detail |
| `tileable-noise` | `gain` | roughness |
| `tileable-noise` | `tileSize` (`"off"/"64"/"128"/"256"/"512"`, string) | tile |
| `color-ramp` | `colorA`, `colorB`, `low`, `high` | low, high, low stop, high stop |
| `math` | `op`, `factor`, `c` | op, factor / B, C |
| `levels` | `min`, `max`, `invert` | out min, out max, invert |
| `principled-bsdf` | `emissionStrength` | emission str |
| `material-output` | `outputResolution` (string) | output res |
| `shape` | `formRandom` | form rand |
| `vector-math` | `operation` (param); ports `vector1`/`vector2` | op; A, B |

When unsure of a key, read the node's def in `material-designer-runtime/src/graph/nodes/`
or copy from a shipped preset — never guess from the label.

## Terminal wiring (every graph)

- `principled-bsdf` output socket is `bsdf` (kind `shader`).
- `material-output` input socket is `surface` (kind `shader`).
- `principled-bsdf` inputs (all optional; unconnected → slider/default, unbaked):
  `baseColor, metallic, roughness, ior, alpha, normal, height, ambientOcclusion,
  coat, coatRoughness, sheen, sheenRoughness, transmission, emission, emissionStrength`.
- `height` is offline-only: baked to its own map, drives parallax-occlusion on the
  surface, never a lit channel. Drive it from the **same** field as `normal-from-height`.

## Common node sockets (from the node defs)

| Node | inputs | outputs |
|---|---|---|
| `tileable-noise` | `coord`(vec) | `field`(float) [+`vector` when curl] |
| `voronoi` | `coord`(vec) | feature-dependent: `distance`/`color`/`position` or `distance`/`random` |
| `color-ramp` | `field`(float) | `color`(color) |
| `levels` | `field`(float) | `field`(float) |
| `math` | `a`,`b`(,`c`)(float) | `field`(float) |
| `blend` | `a`,`b`,`mask`(color/float) | `color`(color) |
| `normal-from-height` | `height`(float) | `normal`(vector) |
| `height-blend` | `heightA`,`heightB`,`breakup`(float) | `fac`(float) |

## Backends (this drives every optimization decision)

- **`offline` (default):** the graph is baked to textures; the surface samples them
  (triplanar + parallax) with stock PBR. Groups and tileable nodes become
  decomposition-cache textures. This is what presets ship for.
- **`live`:** the whole node graph is evaluated per-fragment over `positionWorld`
  (inherently seamless 3D, no tiling). A power/debug path.

See `../SKILL.md` → "Optimizing the graph" for what each backend makes cheap or
expensive, and how the compiler's caching changes how you should structure a graph.
