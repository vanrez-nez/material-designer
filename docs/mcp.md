# Material Designer MCP rendering

The `material-designer` MCP connects to a running Material Designer browser tab and exposes the live
material graph to local agents. This page documents `get_render`, including its ephemeral node-isolation,
comparison, and difference views.

## Connection

Start the development site and leave its browser tab open:

```sh
npm run dev:proxy
```

The usual URL is `http://material-designer.localhost`. The MCP server is registered by [`.mcp.json`](../.mcp.json)
and runs [`scripts/material-mcp-server.mjs`](../scripts/material-mcp-server.mjs). The browser bridge connects
outbound to that local server; a render call fails with `No Material Designer tab connected` when no page is
attached.

After changing the MCP server schema, restart the MCP process. After changing the in-page bridge, refresh
the Material Designer tab. Both sides must be current before testing a new option.

## `get_render`

`get_render` returns an LLM-sized image of the current material. With no node options it preserves the
original behavior and honors any editor eye isolation serialized as `ui.editor.soloNode`.

```json
{
  "size": 768,
  "scale": 1,
  "profile": "standard",
  "maxDim": 768
}
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `size` | number | `768` | Square render size, rounded to a WebGPU-compatible multiple of 64. |
| `scale` | number | `1` | UV repeats across the sphere and plane. |
| `profile` | string | `standard` | Lighting profile: `standard`, `normals`, `metallic`, or `ao`. |
| `maxDim` | number | `768` | Maximum returned image dimension; larger renders are downscaled. |
| `nodeId` | string | — | Node to isolate or evaluate. |
| `view` | string | `solo` when `nodeId` is present | `solo`, `solo-vs-full`, `without-node-vs-full`, or `difference`. |
| `channel` | string | — | Optional raw final PBR channel for `without-node-vs-full` or `difference`. |

Valid channels are `baseColor`, `normal`, `emission`, `roughness`, `metallic`, and `ambientOcclusion`.

### Node views

| `view` | Result |
| --- | --- |
| `solo` | The selected node's first declared non-shader output, rendered exactly like the editor eye. |
| `solo-vs-full` | One aligned image split vertically: isolated node on the left, full graph on the right. |
| `without-node-vs-full` | One aligned image split vertically: graph without the node on the left, full graph on the right. |
| `difference` | Full-frame absolute pixel difference between the graph without the node and the full graph. |

The two comparison views take matching halves from two complete renders. They do not squeeze two scenes
into half-width panels. Their key light is centered horizontally, placing the specular lobe across the seam
so both variants are inspected under the same useful highlight.

Explicit node views operate on cloned documents and clear any existing eye isolation in those clones. They
never change the live document, its edges, or its serialized `soloNode`. Comparison and difference views
require a downstream path from the selected node to Material Output.

Removing a node for `without-node-vs-full` or `difference` is also ephemeral: the clone omits the node and
its incident edges, and disconnected downstream inputs use their normal defaults. No document edit or
safety snapshot is created.

### Examples

Render a node as the editor eye would:

```json
{
  "nodeId": "grain-noise"
}
```

Compare the isolated node with the full material:

```json
{
  "nodeId": "grain-noise",
  "view": "solo-vs-full"
}
```

Compare the material without the node against the full material:

```json
{
  "nodeId": "grain-noise",
  "view": "without-node-vs-full"
}
```

Inspect the node's contribution to one final channel:

```json
{
  "nodeId": "grain-noise",
  "view": "without-node-vs-full",
  "channel": "ambientOcclusion"
}
```

Produce a contribution difference mask:

```json
{
  "nodeId": "grain-noise",
  "view": "difference"
}
```

The same difference can be restricted to one final channel:

```json
{
  "nodeId": "grain-noise",
  "view": "difference",
  "channel": "ambientOcclusion"
}
```

## Difference image and statistics

`difference` compares the full graph with the graph after ephemeral node removal. For each aligned pixel,
it calculates the absolute difference of each display-space RGB byte and uses the largest component as a
single grayscale value:

```txt
diff = max(abs(full.r - without.r), abs(full.g - without.g), abs(full.b - without.b))
```

Black means the two pixels are identical. Brighter gray means a larger change, and white is the maximum
possible byte difference. The image is not contrast-normalized or amplified, so brightness remains an
absolute measure. Difference results are lossless PNGs.

The PNG includes a compact panel such as:

```txt
DIFF  grain-noise  [lit]
CHANGED 21.2%  MEAN 0.6%  P95 1.2%  MAX 38.4%
```

The MCP response also includes the same data as a text content block before the image. This example shows
the response shape; its values are illustrative:

```json
{
  "difference": {
    "nodeId": "grain-noise",
    "channel": "lit",
    "threshold": "2/255",
    "changedPixels": 55575,
    "totalPixels": 262144,
    "changedPercent": 21.2,
    "meanPercent": 0.6,
    "p95Percent": 1.2,
    "maxPercent": 38.4
  }
}
```

The numbers are calculated at `size` before `maxDim` downscaling and before drawing the panel:

- `CHANGED` is the percentage of all image pixels whose difference is at least `2/255`. The threshold
  ignores one-byte readback or rounding noise.
- `MEAN` is the average grayscale difference across all pixels.
- `P95` is the 95th-percentile grayscale difference across all pixels.
- `MAX` is the strongest single-pixel difference.

These statistics measure the rendered image, including material on both the sphere and plane and unchanged
background pixels. They indicate visual contribution, not graph importance or shader cost.

## `audit_node_contributions`

Author-review agents should use `audit_node_contributions` instead of issuing one `get_render` tool call per
node. A call accepts at most eight data-node ids and runs the same lossless 1024px `difference` render for each
node:

```json
{
  "nodeIds": ["broad-rust", "fine-grain", "roughness-breakup"],
  "scale": 1,
  "profile": "standard"
}
```

The MCP server writes each original difference result as a 1024px PNG in the author turn's artifact directory,
using names such as `lit-diff-broad-rust.png`. It returns no image content to the model. Instead, one compact
text response contains `changedPercent`, `meanPercent`, `p95Percent`, and `maxPercent` for every node, plus the
artifact filename, zero-contribution ids, and failures. This preserves the exact evidence while preventing
dozens of images from being retained and replayed in the agent context.

Use repeated batches to cover the final graph. Retry an all-zero node with `scale: 2` or with its intended final
PBR `channel`; remove or rework a node that remains zero. Shader and material-output nodes remain exempt.
The batch tool is available to the author-review runner because that runner supplies its artifact directory;
interactive MCP clients should continue to use `get_render` when they need to see an individual difference image.

### Fast interpretation

- All zeros means no visible contribution under that render profile, channel, scale, and resolution.
- High `CHANGED` with low `MEAN` means a broad but subtle contribution.
- Low `CHANGED` with high `MAX` means a localized strong contribution.
- High `MEAN` and `P95` mean the node materially changes much of the rendered surface.

Compare statistics only when `size`, `scale`, `profile`, and `channel` are the same. A node can contribute
strongly to one channel and have no effect on another, and a lit result depends on the selected lighting
profile.

## Output formats

| Render | Format |
| --- | --- |
| Full render, `solo`, lit comparisons | JPEG |
| Raw-channel comparisons | PNG |
| `difference`, lit or channel | PNG plus structured text statistics |

An unknown node, a shader/output node that cannot use the editor eye, a disconnected node in a comparison,
an unavailable channel, or an unsupported `channel`/`view` combination returns an MCP error rather than
mutating the document.
