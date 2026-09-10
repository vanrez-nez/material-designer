# Material baking pipeline

The GPU renders the material graph in the browser, so to get channels/renders out as files they are
POSTed to a small local **bake server** that writes them under `./bake/` (gitignored).

- Start it alongside the dev server: `npm run bake:server` (listens on `http://127.0.0.1:8788`).
- Dev server: `npm run dev` (or `npm run dev:proxy` -> `http://material-designer.localhost`).

There are two ways to drive a bake:

- **[`/export-bake` POST route](#export-bake-post-route)** — automated/headless; POST an arbitrary
  document and get the full channel + render set on disk. **Preferred for scripting/agents.**
- **[Dev-console handles](#dev-console-handles)** — `__*` helpers exposed in dev builds, driven from the
  app's console against the live material graph.

Contents:

- [Bake server endpoints](#bake-server-endpoints)
- [`/export-bake` POST route](#export-bake-post-route)
  - [Payload reference](#payload-reference)
  - [`render` options](#render-options)
  - [Lighting profiles](#lighting-profiles)
  - [Output layout](#output-layout)
- [Dev-console handles](#dev-console-handles)
- [Multiple-material submission experiment](#multiple-material-submission-experiment)
- [Batch preset generation with an agent](#batch-preset-generation-with-an-agent)

---

## Bake server endpoints

`scripts/bake-server.mjs` (`npm run bake:server`), port `8788` (`BAKE_PORT` overrides), CORS-open. Writes
under `<repo>/bake/`.

| Method / path | Purpose |
|---|---|
| `POST /save?name=<path>` | Write the request body to `bake/<path>` (`name` may nest with `/`; sanitized, no traversal). |
| `POST /export-bake` | Submit a bake job (see below). Held open until the worker reports a result (~180 s timeout). |
| `GET /export-bake/stream` | SSE stream the `/export-bake` worker tab connects to (internal). |
| `POST /export-bake/result` | Worker reports a finished job (internal). |

---

## `/export-bake` POST route

An isolated app route that bakes an **arbitrary `MaterialGraphDocument`** with **no preview scene and
no Tweakpane**. Because the GPU bake only runs in the browser (and a browser tab can't listen for HTTP),
it is a relay: you POST the document to the bake server, which pushes it over SSE to an open
`/export-bake` tab that bakes it and posts the result back.

1. Start the bake server + dev server.
2. Open **`/export-bake`** in a browser (e.g. `http://material-designer.localhost/export-bake`). It boots an
   isolated renderer and connects — the status log shows `connected to bake server — waiting for POST
   jobs`. Leave the tab open; it is the persistent **worker** (one at a time — last connection wins; jobs
   run sequentially).
3. POST the document. The request blocks until the bake finishes and returns the written channels:

   ```sh
   curl -X POST http://127.0.0.1:8788/export-bake \
     -H 'content-type: application/json' \
     -d "$(jq -n --slurpfile d src/scene/material/presets/bark.json \
            '{name:"bark", size:512, doc:$d[0]}')"
   # → {"id":1,"ok":true,"name":"bark","channels":["baseColor","normal","roughness","metallic"]}
   ```

A POST with **no** worker tab open returns `503`. An invalid `doc` (missing `nodes`/`edges`) returns
`400` and writes nothing.

> Convenience: visiting `/export-bake?preset=<key|all>[&size=&channels=]` runs a one-shot bake of
> built-in registry presets at startup (still requires the bake server).

### Payload reference

`POST /export-bake` body:

| Field | Type | Default | Notes |
|---|---|---|---|
| `doc` | `MaterialGraphDocument` | — (required) | The graph to bake. Must have `nodes` + `edges` arrays. |
| `name` | `string` | `"on-the-fly"` | Output folder under `bake/`. May nest with `/` (e.g. `materials/earth-and-ground/cracked-clay`). |
| `size` | `number` | `1024` | Channel resolution (px, square). Rounded to a multiple of 64 (readback alignment). |
| `channels` | `string[]` | all connected | Subset of `baseColor, normal, emission, roughness, metallic, ambientOcclusion`. Unconnected channels are skipped. |
| `overwrite` | `boolean` | `false` | If `false` and `bake/<name>` exists, a numeric postfix is appended at the end (`bark` → `bark-01` → `bark-02`, …). If `true`, writes into `bake/<name>` in place. The response `name` is the folder actually written. |
| `render` | `object` | see below | Demo render config (lighting profiles). |

### `render` options

`render` global defaults apply to every profile; `render.profiles` selects/overrides which profiles to
render.

| Field | Type | Default | Notes |
|---|---|---|---|
| `size` | `number` | `512` | Render px (square), rounded to a multiple of 64. |
| `samples` | `number` | `4` | MSAA. WebGPU supports 4× or off, so `≥2 → 4×`, else off. |
| `shadows` | `boolean` | `true` | Soft PCF shadow (sphere casts onto the plane). |
| `background` | `string` | `"#181818"` | CSS hex background color. |
| `environmentIntensity` | `number` | `0` | IBL (RoomEnvironment PMREM) strength; `0` = no environment. |
| `scale` | `number` | `1` | UV tiling — repeat the material N× across the sphere/plane. |
| `profiles` | `Array<string \| RenderProfile>` | all built-ins | A string selects a built-in; an object overrides/extends one. |

A `RenderProfile` object (used inside `profiles`) accepts: `name` (output stem, required) plus any of
`lightPosition:[x,y,z]`, `lightIntensity`, `ambientStrength`, `environmentIntensity`, `shadows`,
`background`, `size`, `samples`, `scale`. Resolution precedence (low → high):
**hard defaults → `render` globals → built-in profile → per-entry override**.

Examples:

```jsonc
// Render only two built-ins, tiled 2×:
"render": { "scale": 2, "profiles": ["standard", "metallic"] }

// Custom raking light + near-zero ambient on a single profile:
"render": { "profiles": [ { "name": "normals", "lightPosition": [8, 0.4, 0], "ambientStrength": 0.02 } ] }
```

### Lighting profiles

Each rendered profile writes `renders/<name>.png`. Built-ins (default set = all four), with their tuned
values (everything else falls back to the global/hard defaults above):

| Profile | Purpose | `lightPosition` | `lightIntensity` | `ambientStrength` | `environmentIntensity` | `shadows` | `background` |
|---|---|---|---|---|---|---|---|
| `standard` | Balanced key + fill, soft shadow. | `[3,4,5]` | `3.0` | `0.35` | `0` | on | `#181818` |
| `normals` | Low raking light reveals the **normal-map surface relief**. | `[6,0.9,1.2]` | `3.4` | `0.06` | `0` | off | `#101010` |
| `metallic` | Adds an **IBL environment** so metallic surfaces read reflective (not black). | `[3,4,5]` | `1.0` | `0.1` | `1.3` | on | `#202024` |
| `ao` | Ambient-dominant, no shadow, so baked **ambient occlusion** darkening reads. | `[0,6,2]` | `0.25` | `1.1` | `0` | off | `#202020` |

Notes:
- The IBL environment (RoomEnvironment PMREM) is built once per bake, only when a profile needs it.
- `metallic` keeps the doc's **baked metalness** — a dielectric stays matte; the environment just makes
  real metal read.
- Tiling relies on the baked channel targets being `RepeatWrapping`, so `scale > 1` repeats seamlessly.

### Output layout

Each bake writes under `bake/<name>/`:

```txt
bake/<name>/
  preset.json                 # the source document
  channels/<channel>.png      # one per connected channel
  renders/tiled-2x2.png       # 2×2 tile of the baseColor channel (seam check)
  renders/standard.png        # one render per lighting profile …
  renders/normals.png
  renders/metallic.png
  renders/ao.png
```

---

## Dev-console handles

Exposed only in dev builds (`import.meta.env.DEV`), on the normal app route. They bake off the **live
material graph** (or an explicit document) and POST to the same bake server.

| Handle | Signature | Writes |
|---|---|---|
| `__savePng(channel, size?)` | bake one channel of the live material graph | `bake/<channel>.png` |
| `__bakeMaterialTask(doc, folder, size?, channels?, render?)` | full task: preset + channels + tiled proof + profile renders | `bake/<folder>/…` (see [output layout](#output-layout)) |
| `__baker.readImageData(_renderer, controller, channel, size?)` | low-level: returns `ImageData` for a channel | — |
| `__tilingTest(size?)` | bake every Tileable Noise type, score the wrap seam, console.table a summary | `bake/tiling-<type>.png` |
| `__bakeService` | the singleton bake service (advanced) | — |

Single-channel manual bake (equivalent to `__savePng`):

```js
const channel = 'baseColor'; // baseColor | normal | roughness | metallic | ambientOcclusion | emission
const size = 1024;
const img = await __baker.readImageData(__renderer, __scene.materialController, channel, size);
const c = Object.assign(document.createElement('canvas'), { width: size, height: size });
c.getContext('2d').putImageData(img, 0, 0);
const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
await fetch(`http://127.0.0.1:8788/save?name=${channel}.png`, { method: 'POST', body: blob });
```

The Texture tab also has **Export PNG** buttons (browser download) and **Bake → ./bake (dev)** buttons
(POST to the server).

Material-task preview from the console (loads a config, bakes the full set):

```js
const preset = await (await fetch('/configs/materials/ceramic-brick-and-tile/brick/brick-running-bond-red.json')).json();
await __bakeMaterialTask(preset, 'materials/ceramic-brick-and-tile/brick/brick-running-bond-red', 1024);
```

> Note: channels are baked through the graph's **baked** backend (a 2D uv slice). Nodes authored for the
> 3D world-space (live) domain — e.g. the angular `anisotropic-stripes` — can show artifacts/seams when
> baked this way; the bake is faithful to the graph, not necessarily a tileable texture yet.

---

## Multiple-material submission experiment

On 2026-07-30, a bounded two-material submission window was implemented and compared with the existing
one-at-a-time queue in headed Chrome/WebGPU. Each sample requested `eroded-rock` and `bark` together at
256 px with persistent-cache reads bypassed; every resulting channel was read back and hashed.

The paired cold-pipeline comparison could not be made reliable because the browser/driver pipeline cache
survived renderer reloads, so the acceptance decision used the repeatable warm-pipeline runs:

| Window | Median two-material wall time | Result |
|---|---:|---|
| 1 (existing serialization) | 333.0 ms | baseline |
| 2 (bounded pending submissions) | 357.2 ms | 7.3% slower |

Both modes produced the same per-material hashes (`2ed73de7`, `06587c80`), triggered no GPU resource
backoff, and returned Three's tracked texture count from 11 to the pooled baseline of 1 after disposal.
Because the two-entry window missed the required 10% improvement and added lifecycle/error complexity, it
was removed. `MaterialBakeService` therefore continues to serialize full materials and await
`GPUQueue.onSubmittedWorkDone()` after each one.

---

## Batch preset generation with an agent

`npm run material:agent` processes catalog tasks one at a time with Codex or Claude. It builds a prompt
per `catalog/**/material.md` (including node capabilities + the bake instructions above), runs the agent,
and verifies the outputs after each job — failures are logged without stopping the sequence.

**Do not use Playwright** for these jobs: the bake path depends on the app's WebGPU runtime and the
`__bakeMaterialTask` helper in a real browser session (the generated prompt forbids it).

```sh
# Preview the first three prompts without running an agent.
npm run material:agent -- --dry-run --limit 3

# Run five metal materials through Codex.
npm run material:agent -- --agent codex --category metal --limit 5

# Run one specific material through Claude.
npm run material:agent -- --agent claude --only ceramic-brick-and-tile/brick/brick-running-bond-red

# Continue a larger run, skipping materials whose required bake files already exist.
npm run material:agent -- --agent codex --skip-existing
```

Per material, the agent writes `configs/materials/<catalog-relative-path>.json`, then bakes:

```js
const preset = await (await fetch('/configs/materials/<catalog-relative-path>.json')).json();
await __bakeMaterialTask(preset, 'materials/<catalog-relative-path>', 1024);
```

The runner verifies these exist under `bake/materials/<catalog-relative-path>/`: `preset.json`,
`channels/{baseColor,roughness,normal,metallic,ambientOcclusion}.png`, `renders/tiled-2x2.png`, and
`renders/{standard,normals,metallic,ao}.png`. Logs + JSONL summaries land under
`bake/_material-agent-runs/`.

## MCP-only author/reviewer loop

For the MCP connection itself and the `get_render` node-isolation, comparison, channel, and quantitative
difference modes, see **[mcp.md](./mcp.md)**.

`npm run material:author-review` keeps one author thread against the live Material Designer document and
starts a fresh independent reviewer each round. Agent 1 authors, cleans, and revises through the
`material-designer` MCP. Agent 2 receives only
the current round's final `render.png` followed by the original reference images and returns a visual
quality verdict. It does not call MCP or review graph organization. Rejected visual feedback loops back
to Agent 1. The accepted document is saved to the MCP document library only after the review gate passes.

The input is one folder, read recursively, containing Markdown descriptions and PNG, JPEG, or WebP
reference images. The runner starts the repository-pinned Codex CLI directly, so it can be launched
from a normal terminal and does not depend on a parent Codex session. It uses the current local ChatGPT
login, ignores user Codex configuration for the child agents, and supplies only the local
`material-designer` MCP registration to the author. Reviewer turns have no MCP registration and use a
read-only sandbox. API-key and parent-session environment variables are removed from the child process
to prevent accidental API billing or session inheritance.

The child provider uses the authenticated ChatGPT Responses endpoint over HTTPS streaming and explicitly
disables WebSocket transport. The author thread is retained across revisions; each reviewer starts fresh
with only the current render and references. If a turn ends on a retryable 429/5xx or connection failure,
the runner resumes that same in-progress thread; a transient error event does not fail a turn that later
completes successfully.
The author process uses `danger-full-access` with approvals disabled because Material Designer MCP
mutations require that Codex permission profile. Its prompt limits work to this MCP. Reviewer turns use
a read-only sandbox and are limited to inspecting their attached images.

The terminal prints concise, truncated status lines for thinking, tool calls, agent messages, feedback,
errors, and file creation. Full compact evidence is persisted to
`artifacts/material-author-review/<timestamp>-<title>/events.jsonl`. Image and audio base64 bodies are
replaced with mime type and byte-size metadata, and secret-shaped fields are redacted. Use `--log-dir`
to put the complete run archive elsewhere.

Each turn gets `round-<n>/<agent>-<phase>/evidence.jsonl` and `result.json` in the run archive. Author
difference renders are computed at 1024px and stored under its `diffs/` directory as
`<channel>-diff-<node-mode>.png`; other debug renders are discarded. The author alone performs these
contribution checks.

Every author delivery creates `<material-folder>/snapshot/round-<n>/` containing exactly one reviewer
image named `render.png`, the serialized `document.json`, and MCP `snapshot.json` metadata. The final
render is a 1024px standard render. A missing or incorrectly ordered render, snapshot, or document fails
the round before review begins.

The final graph gate requires fewer than 60 total nodes, a friendly contribution-oriented label on every
node, and no unconnected, unreachable, superseded, or non-contributing nodes. The author uses the MCP
`get_render` `difference` view and its statistics to check every diff-capable data node. The
`principled-bsdf` shader and `material-output` nodes are connected but exempt because MCP isolation does
not support shader/output nodes. Revisions must simplify
or replace failed branches before adding new work instead of accumulating patches on a rejected approach.

Start `npm run dev`, open `http://material-designer.localhost`, and leave the tab open. Then run:

```sh
npm run material:author-review -- /path/to/material-task --title "Material title"
```

The in-page bridge connects to a local port pool so the persistent author and reviewer threads can each
use their own Codex MCP server. If the dev page was already open when this runner was installed or
updated, refresh it once before starting the command.

The defaults require a reviewer score of 85 and allow eight revision rounds. `--min-score` and
`--max-rounds` change those gates; `--dry-run` validates and inventories the folder without starting an
agent or creating a log directory. Transient Codex transport failures (including 429 and 503 responses)
retry four times with exponential backoff by default; use `--transport-retries` to change that limit.
All attempts share the turn's `--timeout-minutes` deadline. If the final round is rejected, the live
draft remains unsaved and the command exits nonzero; the event log still contains the complete diagnosis.

The default author is `gpt-5.6-terra` at `high` effort, and the default reviewer is `gpt-5.6-sol` at
`high` effort. `--author-model`, `--author-effort`, `--reviewer-model`, and `--reviewer-effort` are
repeatable schedules. Values are consumed in each agent's turn order; when a run needs more turns than a
schedule supplies, its last value is reused:

```sh
npm run material:author-review -- /path/to/material-task \
  --author-model gpt-5.6-terra --author-effort high \
  --reviewer-model gpt-5.6-sol --reviewer-effort high
```
