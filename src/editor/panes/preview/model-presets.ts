import * as THREE from "three";

import { prepareSampleGeometry } from "./model-loader";

// Sample geometries offered by the scene's model-picker overlay. Three kinds:
//   • `sphere`  — the built-in default/reset (no url, no build → MainScene's kept base sphere).
//   • primitives — three.js geometries generated on demand via `build` (box, cylinder, capsule, torus).
//   • models    — lazy-loaded .obj files served from `public/assets/models/` via `url`.
export interface ModelPreset {
  id: string;
  label: string;
  // Relative to the Vite base URL — a lazy-loaded .obj model.
  url?: string;
  // Builds a three.js primitive on demand, normalized to the sample slot. Exclusive with `url`.
  build?: () => THREE.BufferGeometry;
}

// Center + unit-radius scale (via the loader's normalizer) so a primitive frames like the built-in sphere.
// The built-in wrap UVs of round primitives (cylinder/capsule/torus knot) tile seamlessly on our
// tileable material, but are anisotropic — the texture stretches along the wrapped axis. `uvScale`
// multiplies the UVs to square up the texel density; the wrapped axis MUST use an integer factor so
// the tiling stays aligned across the seam (no visible seam). The box's per-face UVs need no scaling.
const primitive =
  (make: () => THREE.BufferGeometry, uvScale?: [number, number]) => (): THREE.BufferGeometry => {
    const geo = make();
    if (uvScale) {
      const uv = geo.getAttribute("uv");
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uvScale[0], uv.getY(i) * uvScale[1]);
      uv.needsUpdate = true;
    }
    return prepareSampleGeometry(geo);
  };

export const MODEL_PRESETS: ModelPreset[] = [
  { id: "sphere", label: "Sphere" },
  { id: "box", label: "Box", build: primitive(() => new THREE.BoxGeometry(1, 1, 1)) },
  { id: "cylinder", label: "Cylinder", build: primitive(() => new THREE.CylinderGeometry(0.7, 0.7, 1.5, 48), [3, 1]) },
  { id: "capsule", label: "Capsule", build: primitive(() => new THREE.CapsuleGeometry(0.5, 1, 12, 24)) },
  { id: "torus-knot", label: "Torus Knot", build: primitive(() => new THREE.TorusKnotGeometry(0.6, 0.22, 160, 32), [12, 1]) },
  { id: "suzanne", label: "Suzanne", url: "assets/models/suzanne.obj" },
  { id: "teapot", label: "Teapot", url: "assets/models/teapot.obj" },
  { id: "stanford-bunny", label: "Bunny", url: "assets/models/stanford-bunny.obj" },
  { id: "lucy", label: "Lucy", url: "assets/models/lucy.obj" },
];
