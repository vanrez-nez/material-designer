// Predefined sample geometries offered by the scene's model-picker overlay. `sphere` is the built-in
// unit sphere (no url → no fetch, and the default/reset). The rest are lazy-loaded .obj files served
// from `public/assets/models/` — mirrors the data shape of `scene-presets.ts`.
export interface ModelPreset {
  id: string;
  label: string;
  // Relative to the Vite base URL. Omitted for the built-in sphere.
  url?: string;
}

export const MODEL_PRESETS: ModelPreset[] = [
  { id: "sphere", label: "Sphere" },
  { id: "suzanne", label: "Suzanne", url: "assets/models/suzanne.obj" },
  { id: "teapot", label: "Teapot", url: "assets/models/teapot.obj" },
  { id: "stanford-bunny", label: "Bunny", url: "assets/models/stanford-bunny.obj" },
  { id: "lucy", label: "Lucy", url: "assets/models/lucy.obj" },
];
