# Worked examples

- **`derived-skeleton.json`** — the smallest material that demonstrates the method:
  one `tileable-noise` node fans into `color-ramp` (baseColor), `levels` (roughness),
  `normal-from-height` (normal), and the Principled `height` input. The correlation
  principle — and the "reuse is free" optimization — made literal in JSON. Start here
  when learning the document shape.

- **`rusty-metal.json`** — a real shipped preset (28 nodes): stacked multi-scale
  tileable noise → per-scale color ramps → additive blends → Principled, with a
  `normal-from-height` path. Read it for idiomatic structure at production scale.

Both are valid `version: 2` documents. Verify any authored document by baking it and
inspecting the renders (see `../SKILL.md` → "The verification loop").
