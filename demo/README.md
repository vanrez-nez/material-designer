# material-designer-runtime — demo

A standalone demo that renders Material Designer node-graph documents on a lit mesh using the
[`material-designer-runtime`](../src/runtime) package **directly, with no editor** — just plain
three.js + WebGPU driving the `MaterialGraphRuntime` facade.

## Run

```sh
npm install
npm run dev
```

Open the printed URL in a WebGPU-capable browser (Chrome/Edge).

- `/index.html` is the interactive single-material runtime/cache demo.
- `/performance.html` is the 10+ material generation benchmark. It loads every registered preset at 1024px
  by default; use its Tweakpane panel to inspect timings or reload at another resolution.

The performance page is cold on every navigation, including a normal browser reload. Persistent baked
textures are disabled and each page load creates a new run id that is injected into the actual WGSL for
intermediate caches, channel bakes, and visible surface materials. The identity operation does not change
the generated pixels, but it prevents shader and pipeline entries from a previous page load from matching.
The run id is visible in Tweakpane, the `cold` URL parameter, the console, and
`window.__materialPerformance.coldRunId`.

`vite.config.ts` aliases `material-designer-runtime` to the package's **source**
(`../src/runtime/src/index.ts`), so the demo always exercises the working tree — no `npm run build` in the
runtime needed, and no risk of demoing a stale `dist/`. Drop that alias if you specifically want to validate
the built artifact an npm consumer receives.

## What it shows

- Loading documents into the runtime (`setDocument` + `await refresh()`), incl. the built-in default
  and a few sample materials, plus **Load .json…** for an editor-exported document.
- Live parameter tweaks (`setNodeParam` — the Scale slider) and **Resolution** (`setOutputResolution`).
- Swapping the preview **Shape** (sphere / box / plane).
- The **persistent texture cache** — see below.

## Trying the persistent texture cache

Baking is dominated by shader compilation, not rendering. The cache stores the baked channel texels in
IndexedDB and, on a hit, restores them with a GPU-to-GPU copy that short-circuits *before* the compile.

The status readout after every load says which path it took — **baked in N ms** (blue) or **restored from
cache in N ms** (green) — and the panel at the bottom-left shows what is stored. The "restored" label comes
from the runtime's own bake report, not from the timing, because a warm shader pipeline also makes a real
bake look fast.

1. Toggle **Cache → On** (the choice is remembered across reloads — that's what makes step 3 meaningful).
2. Pick **Rock**, the heaviest sample, and watch it *bake*.
3. Switch to another sample and back — or just **reload the page**. Now it *restores*.

Also worth poking at:

- **Rebuild** deletes this document's entry, re-bakes for real (the cache read is bypassed), and only
  resolves once the fresh entry is durably written.
- **Clear** drops every entry, so the next load bakes again.
- **Resolution** is part of the cache key, so each resolution gets its own entry — flip between 512 and 1024
  and the second visit to either is a restore.
- The **Scale** slider re-bakes on every change, but only the value you *settle* on gets captured —
  mid-drag bakes are superseded before the deferred write fires, so a drag costs one readback, not one per
  tick. Each settled value is its own entry, so `entries` and `size` climb as you explore; the LRU then holds
  the total under `budgetBytes`.

The demo tunes two knobs so everything is cacheable and a quick click-through still persists:

```ts
cache: { enabled, minBakeMs: 0, writeDelayMs: 300 }
```

The library defaults (`minBakeMs: 250`, `writeDelayMs: 750`) are the sensible production values — they avoid
spending disk on bakes too cheap to be worth caching, and avoid a GPU readback per tick during a slider drag.

Nothing is stored unless you turn the cache on. To remove it entirely, use **Clear**, or delete the
`material-designer-textures` IndexedDB database in DevTools → Application.

## Build

```sh
npm run build   # tsc --noEmit + Vite multi-page build → dist/
```
