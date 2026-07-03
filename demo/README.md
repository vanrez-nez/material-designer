# material-designer-runtime — demo

A standalone demo that renders Material Designer node-graph documents on a lit mesh using the
[`material-designer-runtime`](../src/runtime) package **directly, with no editor** — just plain
three.js + WebGPU driving the `MaterialGraphRuntime` facade.

## Run

The demo consumes the runtime as a package (`file:../src/runtime`), exactly like an npm consumer would,
so build the runtime first:

```sh
cd ../src/runtime && npm run build   # produces dist/
cd -                                 # back to demo/
npm install                          # links the built runtime + three
npm run dev
```

Open the printed URL in a WebGPU-capable browser (Chrome/Edge).

## What it shows

- Loading documents into the runtime (`setDocument` + `await refresh()`), incl. the built-in default
  and a few sample materials, plus **Load .json…** for an editor-exported document.
- Live parameter tweaks (`setNodeParam` — the Scale slider) and **Resolution** (`setOutputResolution`).
- Swapping the preview **Shape** (sphere / box / plane).

## Build

```sh
npm run build   # tsc --noEmit + vite build → dist/
```
