# Runtime cold-bake compilation pipeline

This report explains how a material graph becomes the textures and surface material shown by the runtime. It is derived from the current implementation only. Existing project documentation was not used as evidence.

The scope is the normal **cold offline bake**: a renderer is attached, the graph is not in solo-preview mode, and no stored texture result short-circuits the work. Warm parameter updates, cache restoration, the live backend, image export, profiling, and the TypeScript/Vite library build are intentionally outside the main walkthrough.

## 1. Friendly overview

Think of the material graph as a recipe. Each box contributes an ingredient or transforms one, and each connection says where its result should go.

1. **The recipe is brought up to date.** Older saved graphs are adjusted to the current shape before anything uses them.
2. **The recipe is checked.** The runtime confirms that the boxes and connections make sense, that every destination has at most one incoming connection, and that the graph does not loop back on itself.
3. **The requested image size is chosen.** This establishes how large the finished material textures will be.
4. **The work is placed in a single line.** Material bakes run one at a time so they do not fight over shared rendering helpers.
5. **The boxes are put in dependency order.** A box is handled only after the boxes that feed it have been handled.
6. **Each box builds its part of the recipe.** Incoming values are gathered, compatible value types are converted when necessary, and the box produces values for the next boxes.
7. **Large sections are split into manageable pieces.** Group outputs and explicitly repeatable patterns can be prepared as helper textures. Those helpers are generated before anything that reads them.
8. **The final material channels are collected.** The runtime identifies which outputs actually exist, such as color, roughness, metalness, surface direction, ambient shading, glow, and optional height.
9. **Reusable materials and empty texture targets are prepared.** Only connected outputs receive rendering jobs.
10. **The rendering programs are prepared.** On supported browsers this is done asynchronously so the page can remain responsive; elsewhere it happens when each output is drawn for the first time.
11. **Every output image is rendered at extra resolution.** It is then reduced to the requested size to smooth fine procedural detail. Direction data receives special handling so it remains valid after averaging.
12. **The runtime waits for completion.** A bake is not reported as finished merely because its commands were submitted.
13. **The finished textures are connected to the surface.** Existing texture objects are kept stable, the material begins sampling the new contents, and interested parts of the application are notified.

The result is not a single compiled file. It is a coordinated set of reusable rendering programs, intermediate helper textures, final channel textures, and a surface material wired to those textures.

## 2. What “compilation” means here

The implementation uses the word “compile” for two related but separate stages:

1. **Graph compilation** converts the serializable node document into Three.js Shader Language values. Its products are a material-channel bundle, parameter values, parameter-usage information, and an ordered intermediate-cache plan. This is JavaScript-side construction; it does not produce pixels.
2. **Renderer pipeline compilation** turns the per-channel node materials into programs the renderer can execute. On Chromium-family browsers the runtime asks Three.js to prepare these asynchronously. Other browsers prepare them synchronously on the first draw.

The **bake** follows those stages: it executes the prepared work to fill textures. Keeping these meanings separate is important because graph construction, renderer preparation, and texture generation have different owners, timing, and failure points.

## 3. Participants and ownership

| Participant | Responsibility in the cold bake |
| --- | --- |
| [`MaterialGraphRuntime`](../src/runtime/src/runtime.ts) | Public facade. Creates the document session and surface, attaches the renderer to the shared bake service, and exposes `refresh()`, the resulting material, busy state, errors, and textures. |
| [`MaterialGraphSession`](../src/runtime/src/document.ts) | Owns the migrated document and node registry. Validates replacement documents, emits graph changes, calls the graph compiler, and records graph-compilation errors. |
| [`NodeRegistry`](../src/runtime/src/graph/registry.ts) | Maps each node type to its ports, parameters, optional dynamic declarations, and `build()` implementation. |
| [`TexturedSurface`](../src/runtime/src/graph/textured-surface.ts) | Owns the presented material and one reusable baked-texture set. It chooses the bake size, requests the cold bake, wires completed textures, controls the busy lifecycle, and notifies consumers. |
| [`MaterialBakeService`](../src/runtime/src/graph/bake-service.ts) | Owns the renderer-facing bake pipeline: serialization, target allocation, graph-compilation request, intermediate-cache rendering, channel preparation, renderer compilation, rendering, synchronization, and progress reports. |
| [`BakedTextureSet`](../src/runtime/src/graph/bake-service.ts) | Owns stable final targets, per-channel bake materials, intermediate targets and materials, retained parameter values, and the cache plan for one surface. |
| [Graph compiler](../src/runtime/src/graph/compiler.ts) | Validates and sorts the graph, recursively builds node outputs, inserts compatible conversions, decomposes groups and tiled nodes, and resolves the terminal material bundle. |
| [Channel baker](../src/runtime/src/graph/channel-baker.ts) | Defines channel encoding, reusable full-screen rendering helpers, asynchronous pipeline preparation, 2× supersampled rendering, and downsampling. |

The shared contracts used across these participants live in [`types.ts`](../src/runtime/src/graph/types.ts). In particular, `MaterialGraphDocument` is the serialized input, `BuildCtx` is the interface given to every node builder, and `MaterialBundle` is the resolved set of material channels.

## 4. Detailed cold-bake sequence

### Step 1: Accept, migrate, and validate the material document

`MaterialGraphRuntime` constructs a `MaterialGraphSession`, using the supplied document and registry or their defaults. The session clones and migrates the document before retaining it. The current migrations recursively update legacy shader nodes and legacy tileable-noise settings, then stamp the current document version.

The session validates the migrated graph by calling `compileSockets()` before accepting it. Loading a replacement document follows the same migrate-then-validate order; the session does not replace its current document until validation succeeds.

Relevant code:

- Runtime composition: [`runtime.ts`](../src/runtime/src/runtime.ts), `MaterialGraphRuntime.constructor()`
- Migration and admission: [`document.ts`](../src/runtime/src/document.ts), `migrateMaterialDocument()`, `MaterialGraphSession.constructor()`, and `setDocument()`
- Validation entry: [`document.ts`](../src/runtime/src/document.ts), `MaterialGraphSession.validate()`

This admission check uses the same graph compiler with a live coordinate domain. It proves that the document can be built, but the cold offline bake later compiles it again with its two-dimensional texture coordinate domain and cache-allocation callbacks. The temporary live material used before a renderer is available is outside this report.

### Step 2: Attach the renderer and request a refresh

`setRenderer()` installs the initialized `WebGPURenderer` on the bake service. `refresh()` delegates to `TexturedSurface.refresh()`, which starts a full rebuild and increments its processing depth. While processing depth is nonzero, `runtime.busy` is true and `whenIdle()` remains pending.

Relevant code:

- Public calls: [`runtime.ts`](../src/runtime/src/runtime.ts), `setRenderer()` and `refresh()`
- Renderer ownership: [`bake-service.ts`](../src/runtime/src/graph/bake-service.ts), `attachRenderer()`
- Processing lifecycle: [`textured-surface.ts`](../src/runtime/src/graph/textured-surface.ts), `refresh()`, `enterProcessing()`, `exitProcessing()`, and `whenIdle()`

### Step 3: Establish output size and the receiving surface material

The surface reads `outputResolution` from the single Material Output node. Invalid or missing values fall back to 1024. For the on-screen bake, the value is rounded to the nearest multiple of 64 and clamped to a minimum of 64. This alignment also makes later pixel readback compatible with WebGPU row alignment.

The existing `BakedTextureSet` is resized in place. Keeping its `THREE.Texture` wrappers stable is a deliberate ownership rule: consumers can remain bound to the same objects while their backing contents and dimensions change.

The surface also reads the material family and construction-time settings from the shader node feeding Material Output. On the first cold bake, or when this signature differs, it creates the matching stock node-material family. A normal cold bake therefore has a destination surface ready before any channel texture is produced.

Relevant code:

- Resolution and material settings: [`compiler.ts`](../src/runtime/src/graph/compiler.ts), `readOutputResolution()` and `readMaterialSurface()`
- Size normalization and family reconciliation: [`textured-surface.ts`](../src/runtime/src/graph/textured-surface.ts), `surfaceBakeSize()` and `rebuild()`
- Stable target resizing: [`bake-service.ts`](../src/runtime/src/graph/bake-service.ts), `BakedTextureSet.resize()`

### Step 4: Enter the shared serial bake queue

`TexturedSurface.rebuild()` calls `MaterialBakeService.bakeInto()` with the reusable texture set, graph source, source label, and current solo/cache flags. For the cold path described here, no solo node is set and no stored result is restored.

`bakeInto()` appends the work to one promise chain. The queue is shared because the channel baker reuses module-level full-screen quads, render targets, and renderer state. Each job sets the active label, emits aggregate progress, and advances the queue even if the job throws, preventing one bad graph from permanently blocking later work.

Relevant code:

- Rebuild request: [`textured-surface.ts`](../src/runtime/src/graph/textured-surface.ts), `rebuild()`
- Queue and cold-bake entry: [`bake-service.ts`](../src/runtime/src/graph/bake-service.ts), `enqueue()` and `bakeInto()`

### Step 5: Start the offline graph compilation

The bake service calls `graph.compileBundle()` with `backend: "offline"` and two ownership callbacks:

- `allocCache` asks the `BakedTextureSet` for an intermediate texture of the required size and filtering mode.
- `allocConstantArray` asks the set for retained array-backed parameter storage.

`MaterialGraphSession.compileBundle()` forwards to `compileSockets()` and records any thrown error in `lastError`. The compiler first resolves the authored output resolution and chooses the offline coordinate domain: every procedural node receives a two-dimensional texture coordinate represented as a three-component value with zero in the third component.

Relevant code:

- Offline compiler request: [`bake-service.ts`](../src/runtime/src/graph/bake-service.ts), `bakeInto()`
- Error-tracking facade: [`document.ts`](../src/runtime/src/document.ts), `compileBundle()`
- Compiler setup: [`compiler.ts`](../src/runtime/src/graph/compiler.ts), `CompileOptions` and `compileSockets()`

At this point the runtime also performs a document-wide backward scan from nodes that calculate derivatives. The scan crosses group boundaries and marks intermediate values that must retain extra detail before a later normal calculation.

### Step 6: Validate the graph structure

For the root document, the compiler requires exactly one Material Output node. For every nested group document, it requires exactly one Group Output node.

It then checks every edge:

1. Source and destination node IDs must exist.
2. The named output and input ports must exist on those node instances.
3. Their value kinds must match or have an allowed conversion.
4. A destination input may have only one incoming edge.

Ports are resolved through `nodePorts()`, so per-instance group ports and parameter-driven dynamic ports are validated in their current form rather than against a fixed global list.

Relevant code:

- Structural checks: [`compiler.ts`](../src/runtime/src/graph/compiler.ts), `validate()`
- Effective ports and registry failures: [`registry.ts`](../src/runtime/src/graph/registry.ts), `nodePorts()` and `NodeRegistry.get()`
- Allowed value conversions: [`types.ts`](../src/runtime/src/graph/types.ts), `COERCION_MATRIX` and `coercionFor()`

### Step 7: Put nodes in dependency order

`topoSort()` calculates the number of incoming dependencies for every node, starts with nodes that have none, and removes satisfied dependencies as it proceeds. The resulting order guarantees that an upstream node has produced its values before a downstream node requests them.

If the number of sorted nodes does not match the number in the document, the remaining nodes form a cycle and compilation stops with `Material graph has a cycle`.

Relevant code:

- Dependency ordering and cycle detection: [`compiler.ts`](../src/runtime/src/graph/compiler.ts), `topoSort()`

### Step 8: Build each node’s outputs

`compileDocument()` walks the sorted IDs and maintains three central maps:

- `outputsByNode`: values produced by each node, available to downstream connections.
- `uniformsByNode`: parameter nodes that can be updated in place after compilation.
- `usageByNode`: whether each consumed parameter was treated as a live value or a construction-time constant.

For a normal node, the compiler performs this exact order:

1. Resolve its effective ports from the registry.
2. Resolve each connected input from the already-built upstream output map.
3. When compatible port kinds differ, inject the defined conversion: scalar broadcast, vector-component average, color luminance, or vector/color reinterpretation.
4. Create parameter nodes for all declared numeric, color, vector, and curve parameters. Non-finite numeric input falls back to the parameter default and then zero, preventing invalid shader source.
5. Calculate any offline repeat factor for nodes that support reusable tile baking.
6. Create a `BuildCtx` containing resolved inputs, the offline coordinate, backend, repeat factor, and the only permitted parameter accessors.
7. Call the registered node definition’s `build()` function.
8. Store the returned value for each output port, or replace a qualifying tiled output with a sample of its new helper texture.

The `BuildCtx` accessors form an important compilation contract. `live()` records a value that can remain a renderer parameter, while `constant()` records a value consumed while constructing the program. `constantArray()` records construction-time array data while allowing the texture set to retain and update the same array node safely across rebuilds. If a parameter is consumed both ways, construction-time use wins.

Relevant code:

- Ordered node execution: [`compiler.ts`](../src/runtime/src/graph/compiler.ts), `compileDocument()`
- Input resolution and conversions: [`compiler.ts`](../src/runtime/src/graph/compiler.ts), `resolveInputs()`, `resolveEdgeValue()`, and `coerce()`
- Parameter creation and usage recording: [`compiler.ts`](../src/runtime/src/graph/compiler.ts), `buildUniforms()` and `makeBuildCtx()`
- Node build contract: [`types.ts`](../src/runtime/src/graph/types.ts), `BuildCtx` and `MaterialNodeDef`
- Concrete node lookup: [`registry.ts`](../src/runtime/src/graph/registry.ts), `NodeRegistry`

### Step 9: Recursively compile groups and build the intermediate-cache plan

A Group Input node does not run a builder. Its outputs are seeded from values connected to the parent group. A group node recursively compiles its nested document with those seeds, then reads the values connected to the nested Group Output node back as the parent group’s outputs.

During the cold offline bake, cacheable group outputs are deliberately not inlined into every final channel. Instead, the compiler:

1. Allocates a texture identified by `groupId/portKey`.
2. Appends an entry describing the value that must be rendered into it.
3. Replaces the downstream group output with a sample of that texture.

Nested groups append their entries while recursively compiling, so the resulting `cachePlan` is already bottom-up: prerequisites appear before consumers.

If a cache computes a derivative or feeds one later, its sizing includes a 2048-pixel minimum. The bake service caps the concrete allocation at 4096 and enables mipmaps so a smaller consumer receives an area-averaged result. Ordinary group caches use the current bake size.

A node marked `bakeTileable` can create another kind of cache. When its `tileSize` is active, it renders one smaller repeating block into a `nodeId/field` texture and replaces the output with a repeated texture sample. Its repeat factor derives from the authored output resolution and the node’s feature scale.

Relevant code:

- Group recursion and decomposition: [`compiler.ts`](../src/runtime/src/graph/compiler.ts), `compileGroup()`
- Derivative dependency analysis: [`compiler.ts`](../src/runtime/src/graph/compiler.ts), `dependsOnDerivative()` and `derivativeTaintedCaches()`
- Tile decomposition: [`compiler.ts`](../src/runtime/src/graph/compiler.ts), `tileRepeatFor()` and `maybeTileNode()`
- Concrete cache sizing and allocation: [`bake-service.ts`](../src/runtime/src/graph/bake-service.ts), `cacheSizeFor()`, `cacheWantsMips()`, `makeCacheTarget()`, and `BakedTextureSet.cacheTarget()`

Intermediate cache targets use half-float storage, no color conversion, repeat wrapping, and optional mipmaps. They are rendered directly rather than through the final channel’s extra-resolution pass, preserving values such as heights, distances, and warped coordinates that would be damaged by an 8-bit intermediate.

### Step 10: Resolve the terminal material bundle

After all root nodes have been built, the compiler locates the edge feeding Material Output’s `surface` input. The source is a shader-kind value carrying a `MaterialBundle`, not a renderable scalar or vector. If the terminal is unconnected, the bundle is empty.

The normal cold path returns four products in `CompiledSockets`:

| Product | Meaning |
| --- | --- |
| `bundle` | The connected material values, including optional base color, roughness, metalness, normal, ambient occlusion, emission, height, opacity, and supported material-lobe values. |
| `uniforms` | Per-node parameter nodes created during this compilation. |
| `cachePlan` | Intermediate textures to render before the final channels, already in dependency order. |
| `paramUsage` | The recorded live-versus-construction-time use of each consumed parameter. |

Relevant code:

- Final selection and return value: [`compiler.ts`](../src/runtime/src/graph/compiler.ts), `compileSockets()` and `resolveBundle()`
- Bundle contract: [`types.ts`](../src/runtime/src/graph/types.ts), `MaterialBundle`

### Step 11: Turn the bundle into render jobs and targets

Back in `bakeInto()`, the texture set retains the returned uniform map, parameter-usage map, and cache plan. Intermediate targets no longer named by the plan are pruned so deleted groups or document replacements do not leave large resources alive.

The service examines the supported surface-channel list in order: base color, roughness, metalness, ambient occlusion, normal, and emission. It creates a job only when the bundle contains that channel.

For each connected channel it:

1. Obtains the channel’s reusable `MeshBasicNodeMaterial`.
2. Converts the value to its storage convention.
3. Assigns the result to `colorNode` and marks the material for recompilation.
4. Obtains the channel’s stable render target.
5. Records whether special normal downsampling is needed.

Scalar channels are expanded to grayscale. Base color and emission are encoded for color-texture storage. Normal data is left in its already encoded vector form. Height, when present, receives a separate linear target and job because it drives surface offset sampling rather than a lit material channel.

Final channel textures use repeat wrapping, mipmaps, trilinear minification, linear magnification, and anisotropy up to eight. Base color and emission are tagged as color textures; scalar, normal, and height outputs remain linear data.

Relevant code:

- Channel selection and job construction: [`bake-service.ts`](../src/runtime/src/graph/bake-service.ts), `SURFACE_CHANNELS` and `bakeInto()`
- Persistent target/material ownership: [`bake-service.ts`](../src/runtime/src/graph/bake-service.ts), `BakedTextureSet.target()`, `channelMaterial()`, and `ensureHeightTarget()`
- Encoding and texture settings: [`channel-baker.ts`](../src/runtime/src/graph/channel-baker.ts), `encodeChannel()` and `configureChannelTexture()`

### Step 12: Render intermediate caches first

The service walks `cachePlan` in its existing bottom-up order. For every entry, it assigns the entry’s value to the cache material, marks that material for recompilation, and renders it directly into the matching half-float target.

This ordering is load-bearing: final channel programs sample the intermediate textures, and a parent cache may sample a child cache. Rendering a consumer first would use missing or stale contents.

Cache materials are compiled synchronously on their first render. Their programs are intentionally limited to decomposed sections of the graph; the later final-channel programs sample the results instead of containing every group’s full calculation.

Relevant code:

- Ordered cache dispatch: [`bake-service.ts`](../src/runtime/src/graph/bake-service.ts), the `cachePlan` loop in `bakeInto()`
- Direct cache draw: [`channel-baker.ts`](../src/runtime/src/graph/channel-baker.ts), `renderCacheToTarget()`

### Step 13: Prepare the final channel renderer pipelines

On Chromium-family browsers, `ASYNC_PIPELINE_COMPILE` enables an asynchronous preparation phase. The service emits a `shaders` report, raises `compileGateDepth`, and passes all connected channel materials to `compileMaterialsAsync()`.

That helper places one full-screen quad per material in a temporary scene, switches the renderer to a pooled target matching the real extra-resolution render format, and awaits `renderer.compileAsync()`. Three.js processes these work items sequentially while yielding between them; this is responsive preparation, not parallel channel compilation. The previous render target is restored afterward.

The compile gate protects shared renderer state during the asynchronous window. `rendererBusy` remains true while the gate is held, and an application render loop must avoid using that renderer until the gate closes.

On non-Chromium browsers, this pre-warm phase is skipped. Each material’s pipeline is then compiled synchronously by its first real render in the next step.

Relevant code:

- Browser selection, reports, and compile gate: [`bake-service.ts`](../src/runtime/src/graph/bake-service.ts), `ASYNC_PIPELINE_COMPILE`, `rendererBusy`, and the precompile block in `bakeInto()`
- Format-matched preparation scene: [`channel-baker.ts`](../src/runtime/src/graph/channel-baker.ts), `compileMaterialsAsync()`

### Step 14: Render and downsample every final channel

The service renders the prepared jobs sequentially. `renderMaterialToTarget()` performs two draws per channel:

1. Render the channel into a pooled target whose width and height are each twice the destination dimensions.
2. Draw a box-filtered result into the final destination by averaging the corresponding 2×2 high-resolution samples.

The high-resolution targets are pooled by dimensions. They are not repeatedly resized, because resizing would destroy and recreate their backing resources while edits were arriving.

For ordinary color and scalar outputs, the four samples are averaged directly. For normals, each sample is first decoded from its stored zero-to-one form into a signed direction, the directions are averaged and normalized, and the result is encoded back. Directly averaging encoded normal colors would produce invalid directions.

The renderer’s previously active target is restored after each operation. The channel material’s `colorNode` is not reassigned inside the render helper, so the pipeline prepared in the preceding step is the one used for the actual draw.

Relevant code:

- Final job dispatch: [`bake-service.ts`](../src/runtime/src/graph/bake-service.ts), the channel render loop in `bakeInto()`
- Two-stage rendering and pooled targets: [`channel-baker.ts`](../src/runtime/src/graph/channel-baker.ts), `ssTargetsFor()` and `renderMaterialToTarget()`
- Normal-aware averaging: [`channel-baker.ts`](../src/runtime/src/graph/channel-baker.ts), `downsampleNode()`

### Step 15: Wait for real completion and finalize bake state

After all draws have been submitted, the texture set records which channels and height output are present. This creates a signature used to decide whether the receiving surface must be rewired.

The service then waits for actual completion. It prefers the device queue’s `onSubmittedWorkDone()` signal; if that is unavailable, it forces synchronization by reading one pixel from an existing target. The bake promise therefore represents finished work, not merely queued work.

The completed report combines four measured phases:

- JavaScript graph compilation
- Asynchronous renderer preparation, when supported
- Render dispatch
- Waiting for execution to finish

The set is marked as genuinely rendered, its content stamp advances, and the rebuild duration is retained. If persistent caching is configured, the service schedules a later capture at this point, but that deferred storage path is not part of compilation and is not awaited by the cold bake.

Relevant code:

- Presence and content state: [`bake-service.ts`](../src/runtime/src/graph/bake-service.ts), `BakedTextureSet.setPresence()` and the end of `bakeInto()`
- Completion barrier: [`bake-service.ts`](../src/runtime/src/graph/bake-service.ts), `gpuSync()`
- Phase telemetry: [`bake-service.ts`](../src/runtime/src/graph/bake-service.ts), `BakeReport`

### Step 16: Wire the completed textures into the presented material

Control returns to `TexturedSurface.rebuild()`. On the first bake, when the material family changed, or when the connected-channel signature changed, `wire()` points the receiving material’s nodes at the stable baked textures.

Wiring respects the selected material family’s capabilities:

- Base color and normal are common surface inputs.
- Roughness and metalness are attached only to material families that support them.
- Ambient occlusion is multiplied by the mesh’s `vertexAo` attribute where supported.
- Emission is attached only to emissive-capable families.
- Height can affect UV sampling when parallax is enabled; triplanar sampling uses its separate world-projection path.

The surface marks the receiving material for renderer update, publishes it as the current material, and notifies both material-rebuild listeners and direct texture consumers. Superseded material objects are disposed only after listeners have had a chance to point meshes at the replacement. Finally, processing depth is decremented; when it reaches zero, `busy` becomes false and all `whenIdle()` waiters resolve.

The bake service prepares the internal materials used to generate the channel textures; it does **not** precompile the final on-screen surface material. Setting `needsUpdate` tells Three.js to prepare that material's renderer pipeline when the application's render loop next draws it. The cold-bake promise therefore guarantees that the textures are complete and wired, not that a later scene draw has already compiled every possible surface variant.

Relevant code:

- Texture wiring and family capability gates: [`textured-surface.ts`](../src/runtime/src/graph/textured-surface.ts), `wire()`
- Completion, notification, and safe disposal: [`textured-surface.ts`](../src/runtime/src/graph/textured-surface.ts), the end of `rebuild()`
- Capability table: [`types.ts`](../src/runtime/src/graph/types.ts), `MATERIAL_TYPE_CAPS`

## 5. End-to-end products

The cold bake transforms and retains several different products rather than collapsing everything into one object:

| Stage | Product | Owner / consumer |
| --- | --- | --- |
| Document admission | Migrated, validated `MaterialGraphDocument` | `MaterialGraphSession` |
| Graph compilation | Per-node outputs | Used internally while downstream nodes build |
| Graph compilation | Per-node parameter values and usage categories | Retained by `BakedTextureSet` |
| Graph compilation | Bottom-up `CacheEntry[]` | Rendered by `MaterialBakeService` |
| Graph compilation | Resolved `MaterialBundle` | Converted into connected channel jobs |
| Intermediate rendering | Half-float helper textures | Sampled by later caches and final channels |
| Renderer compilation | Prepared per-channel pipelines | Reused by the actual channel draws |
| Final rendering | Stable channel and optional height textures | Sampled by the presented surface material |
| Surface wiring | Family-specific `NodeMaterial` | Returned by `getNodeMaterial()` and assigned to meshes |

## 6. Failure and lifecycle behavior

- **Invalid documents fail before replacement.** Unknown nodes, missing ports, unsupported type connections, duplicate incoming connections, missing or duplicate terminal nodes, and cycles throw during compilation. Admission-time validation throws before replacing the session document; a failure from the cold bake's `compileBundle()` call is also recorded in the session's `lastError`.
- **Bake failures do not kill the global queue.** The individual bake promise rejects, but the service converts the shared queue tail back to a resolved promise so later jobs can still run.
- **Surface rebuild errors are contained.** `TexturedSurface` records and logs the error, completes its processing lifecycle, and exposes the message through `MaterialGraphRuntime.lastError`.
- **No renderer means no cold bake.** `bakeInto()` returns without rendering when the service has no renderer. The runtime’s temporary live fallback is a separate path and is outside this walkthrough.
- **The render loop has two gates.** `runtime.busy` covers the whole surface rebuild, including target resizing; `service.rendererBusy` specifically covers asynchronous renderer compilation that temporarily owns shared renderer state.
- **Texture objects remain stable.** Rebuilds resize and refill targets instead of replacing their wrapper objects. This prevents consumers from submitting references to textures that were destroyed mid-update.
- **Intermediate resources are bounded by ownership.** Orphaned group/tile caches are pruned after compilation, final targets and per-channel materials are reused, and supersample targets are pooled by size.
- **Completion provides back-pressure.** The next queued bake cannot begin until the previous bake’s submitted work has actually completed.

## 7. Deliberate boundaries

The following code paths exist in the runtime but are not part of this cold-bake report:

- Updating retained parameter values and rerendering existing targets without graph or renderer recompilation
- Restoring final texels from persistent storage or writing a completed bake back to storage
- Presenting the fully procedural live backend
- Solo-node preview compilation
- One-channel image readback for previews or export
- Per-node profiling
- Building the runtime package with TypeScript and Vite

Those paths share some of the participants above, but mixing them into the numbered cold sequence would make it unclear which work a first full bake actually performs.
