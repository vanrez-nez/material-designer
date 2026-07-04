import * as THREE from "three";

// Loads .obj files into a single normalized BufferGeometry ready to be used as the material sample.
// OBJLoader + BufferGeometryUtils are dynamically imported so they stay out of the initial bundle —
// the app only pays for them when the user actually picks a model.

// Merge an OBJ import (a Group of meshes) into one geometry, then normalize it for the sample slot.
// A model's own UV unwrap (with seams) is preferred and preserved; box-projected UVs are only a
// fallback for UV-less meshes (see prepareSampleGeometry). Normals are computed when absent.
async function fromObjGroup(group: THREE.Object3D): Promise<THREE.BufferGeometry> {
  const geometries: THREE.BufferGeometry[] = [];
  group.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const geo = (child as THREE.Mesh).geometry as THREE.BufferGeometry;
      geo.deleteAttribute("uv1"); // secondary UV set is unused; drop for merge consistency
      if (!geo.getAttribute("normal")) geo.computeVertexNormals();
      geometries.push(geo);
    }
  });

  if (geometries.length === 0) throw new Error("OBJ contained no mesh geometry");

  let merged: THREE.BufferGeometry;
  if (geometries.length === 1) {
    merged = geometries[0];
  } else {
    // mergeGeometries requires a consistent attribute set — if some children have UVs and others
    // don't, drop UVs across the board and fall back to box projection so the merge succeeds.
    const anyUv = geometries.some((g) => g.getAttribute("uv"));
    const allUv = geometries.every((g) => g.getAttribute("uv"));
    if (anyUv && !allUv) for (const g of geometries) g.deleteAttribute("uv");
    const { mergeGeometries } = await import("three/examples/jsm/utils/BufferGeometryUtils.js");
    merged = mergeGeometries(geometries, false) ?? geometries[0];
  }

  return prepareSampleGeometry(merged);
}

// Normalize an arbitrary geometry so it drops into the sample slot like the built-in unit sphere:
// centered at the origin, scaled to a ~unit bounding radius, with normals and UVs. The material
// samples uv() and reads a vertexAo attribute — vertexAo is added by MainScene on assign.
export function prepareSampleGeometry(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  if (!geo.getAttribute("normal")) geo.computeVertexNormals();

  // Center on the origin and scale so the bounding sphere radius ≈ 1, matching SphereGeometry(1).
  geo.center();
  geo.computeBoundingSphere();
  const radius = geo.boundingSphere?.radius ?? 1;
  if (radius > 0) geo.scale(1 / radius, 1 / radius, 1 / radius);

  // Prefer the model's own UV unwrap (seams intact); only synthesize UVs when the mesh has none.
  if (!geo.getAttribute("uv")) generateBoxUv(geo);
  return geo;
}

// Box (planar) UV projection: for each vertex, project onto the plane perpendicular to the dominant
// axis of its normal, normalized into 0..1 by the geometry's largest bounding-box extent so tiling
// density is consistent across models. Good enough for material preview on UV-less meshes.
function generateBoxUv(geo: THREE.BufferGeometry): void {
  const position = geo.getAttribute("position");
  const normal = geo.getAttribute("normal");
  geo.computeBoundingBox();
  const box = geo.boundingBox!;
  const size = new THREE.Vector3();
  box.getSize(size);
  const extent = Math.max(size.x, size.y, size.z) || 1;

  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    const px = position.getX(i);
    const py = position.getY(i);
    const pz = position.getZ(i);
    const nx = Math.abs(normal.getX(i));
    const ny = Math.abs(normal.getY(i));
    const nz = Math.abs(normal.getZ(i));

    let u: number;
    let v: number;
    if (nx >= ny && nx >= nz) {
      // X-dominant face → project onto ZY
      u = (pz - box.min.z) / extent;
      v = (py - box.min.y) / extent;
    } else if (ny >= nx && ny >= nz) {
      // Y-dominant face → project onto XZ
      u = (px - box.min.x) / extent;
      v = (pz - box.min.z) / extent;
    } else {
      // Z-dominant face → project onto XY
      u = (px - box.min.x) / extent;
      v = (py - box.min.y) / extent;
    }
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

// Lazy-fetch and normalize a predefined model. `url` is relative to the Vite base URL.
export async function loadModelGeometry(url: string): Promise<THREE.BufferGeometry> {
  const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js");
  const group = await new OBJLoader().loadAsync(`${import.meta.env.BASE_URL}${url}`);
  return fromObjGroup(group);
}

// Parse a user-supplied .obj file's text (OBJ is plain text) into a normalized sample geometry.
export async function parseModelGeometry(objText: string): Promise<THREE.BufferGeometry> {
  const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js");
  const group = new OBJLoader().parse(objText);
  return fromObjGroup(group);
}
