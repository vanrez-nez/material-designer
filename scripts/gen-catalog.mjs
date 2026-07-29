// Regenerates the material catalog into public/catalog/ — optimized JPEG thumbnails plus the index
// (catalog.json) the app fetches at runtime. This script is the single source of truth for the fixture
// catalog: edit the AUTHORING data below and re-run. `nodeCount` is derived from the referenced preset;
// `textures` is authored here (deriving the connected PBR channels would need the runtime compiler, out of
// scope for a plain node script). Uses `sharp` (a dev-only dependency) to resize + JPEG-encode thumbnails;
// it is not part of the app bundle or the Pages build, which just consume the committed thumbnails.
//
// Usage: node scripts/gen-catalog.mjs   (or: npm run catalog)
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "catalog");
const SIZE = 256;
const JPEG_QUALITY = 80;

// Shared JPEG optimization: square cover crop at SIZE, mozjpeg + progressive for the smallest files.
const toThumbnail = (image) =>
  image
    .resize(SIZE, SIZE, { fit: "cover", position: "centre" })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true, progressive: true });

// --- authoring data (edit me, then re-run) -----------------------------------------------------------
const CATEGORIES = [
  { id: "ground", label: "Ground" },
  { id: "metal", label: "Metal" },
  { id: "wood", label: "Wood" },
  { id: "tile", label: "Tile" },
];

// `textures` lists the bakeable PBR channels actually driven by a graph edge into the shader node —
// inputs left on their constant param (and height, which is not a baked channel) are not listed.
const MATERIALS = [
  { id: "asphalt", name: "Asphalt", category: "ground", preset: "asphalt", textures: ["Base Color", "Roughness", "Normal"] },
  { id: "cobblestone-setts", name: "Cobblestone Setts", category: "ground", preset: "cobblestone-setts", textures: ["Base Color", "Roughness", "Normal", "Ambient Occlusion"] },
  { id: "dark-volcanic-stone", name: "Dark Volcanic Stone", category: "ground", preset: "dark-volcanic-stone", textures: ["Base Color", "Normal"] },
  { id: "flamed-basalt", name: "Flamed Basalt", category: "ground", preset: "flamed-basalt", textures: ["Base Color", "Roughness", "Normal", "Ambient Occlusion"] },
  { id: "lichen-stone", name: "Lichen Stone", category: "ground", preset: "lichen-stone", textures: ["Base Color", "Roughness", "Normal", "Ambient Occlusion"] },
  { id: "bark", name: "Bark", category: "wood", preset: "bark", textures: ["Base Color", "Roughness", "Normal"] },
  { id: "ebonized-wood", name: "Ebonized Wood", category: "wood", preset: "ebonized-wood", textures: ["Base Color", "Roughness", "Normal", "Ambient Occlusion"] },
  { id: "wood", name: "Wood", category: "wood", preset: "wood", textures: ["Base Color", "Roughness", "Normal", "Ambient Occlusion"] },
];

// --- thumbnail rendering -----------------------------------------------------------------------------
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

// A soft diagonal gradient between two hues seeded from the material id.
function renderPixels(id) {
  const seed = hash(id);
  const h1 = seed % 360;
  const h2 = (h1 + 40 + (seed % 80)) % 360;
  const a = hslToRgb(h1, 0.45, 0.42);
  const b = hslToRgb(h2, 0.5, 0.28);
  const buf = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const t = (x + y) / (2 * (SIZE - 1));
      const i = (y * SIZE + x) * 4;
      buf[i] = Math.round(a[0] + (b[0] - a[0]) * t);
      buf[i + 1] = Math.round(a[1] + (b[1] - a[1]) * t);
      buf[i + 2] = Math.round(a[2] + (b[2] - a[2]) * t);
      buf[i + 3] = 255;
    }
  }
  return buf;
}

function countNodes(doc) {
  let n = 0;
  for (const node of doc.nodes ?? []) {
    n += 1;
    if (node.subgraph) n += countNodes(node.subgraph);
  }
  return n;
}

// --- generate ----------------------------------------------------------------------------------------
// Thumbnails prefer the material's rendered preview (the lit sphere/plane produced by the bake pipeline:
// bake/<preset>/renders/standard.png, via `npm run bake:server` + bakeMaterialTask), resized + optimized
// to a JPEG. Materials without a render fall back to a deterministic gradient placeholder.
mkdirSync(outDir, { recursive: true });

const materials = await Promise.all(
  MATERIALS.map(async (material) => {
    const render = join(root, "bake", material.preset, "renders", "standard.png");
    const dest = join(outDir, `${material.id}.jpg`);
    let thumbSource;
    if (existsSync(render)) {
      await toThumbnail(sharp(render)).toFile(dest);
      thumbSource = "render";
    } else {
      await toThumbnail(
        sharp(renderPixels(material.id), { raw: { width: SIZE, height: SIZE, channels: 4 } }),
      ).toFile(dest);
      thumbSource = "placeholder";
    }
    // Drop the legacy PNG thumbnail so stale copies don't linger next to the new JPEG.
    rmSync(join(outDir, `${material.id}.png`), { force: true });

    let nodeCount = 0;
    try {
      nodeCount = countNodes(JSON.parse(readFileSync(join(root, "src", "presets", `${material.preset}.json`), "utf8")));
    } catch {
      console.warn(`[catalog] preset not found for "${material.id}" (${material.preset}) — nodeCount 0`);
    }
    return {
      entry: {
        id: material.id,
        name: material.name,
        category: material.category,
        preset: material.preset,
        thumbnail: `catalog/${material.id}.jpg`,
        nodeCount,
        textures: material.textures,
      },
      thumbSource,
    };
  }),
);

writeFileSync(
  join(outDir, "catalog.json"),
  `${JSON.stringify({ categories: CATEGORIES, materials: materials.map((m) => m.entry) }, null, 2)}\n`,
);

console.log(`wrote ${materials.length} thumbnails + catalog.json → public/catalog/`);
console.table(
  materials.map(({ entry, thumbSource }) => ({
    id: entry.id,
    category: entry.category,
    nodeCount: entry.nodeCount,
    thumb: thumbSource,
  })),
);
