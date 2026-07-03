// Regenerates the material catalog into public/catalog/ — both the placeholder thumbnail PNGs and the
// index (catalog.json) the app fetches at runtime. This script is the single source of truth for the
// fixture catalog: edit the AUTHORING data below and re-run. No dependencies (a tiny PNG encoder over
// node:zlib). `nodeCount` is derived from the referenced preset; `textures` is authored here (deriving
// the connected PBR channels would need the runtime compiler, out of scope for a plain node script).
//
// Usage: node scripts/gen-catalog.mjs   (or: npm run catalog)
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "catalog");
const SIZE = 256;

// --- authoring data (edit me, then re-run) -----------------------------------------------------------
const CATEGORIES = [
  { id: "ground", label: "Ground" },
  { id: "metal", label: "Metal" },
  { id: "wood", label: "Wood" },
  { id: "tile", label: "Tile" },
];

const MATERIALS = [
  { id: "cracked-clay", name: "Cracked Clay", category: "ground", preset: "cracked-clay", textures: ["Base Color", "Roughness", "Normal", "Ambient Occlusion"] },
  { id: "rock", name: "Rock", category: "ground", preset: "rock", textures: ["Base Color", "Roughness", "Normal", "Ambient Occlusion"] },
  { id: "asphalt", name: "Asphalt", category: "ground", preset: "asphalt", textures: ["Base Color", "Roughness", "Normal"] },
  { id: "zinc", name: "Zinc", category: "metal", preset: "zinc", textures: ["Base Color", "Roughness", "Metallic"] },
  { id: "rusty-metal", name: "Rusty Metal", category: "metal", preset: "rusty-metal", textures: ["Base Color", "Roughness", "Metallic", "Normal"] },
  { id: "bark", name: "Bark", category: "wood", preset: "bark", textures: ["Base Color", "Roughness", "Normal"] },
  { id: "wood-planks", name: "Wood Planks", category: "wood", preset: "wood-planks", textures: ["Base Color", "Roughness", "Normal"] },
  { id: "parquet", name: "Parquet", category: "wood", preset: "parquet", textures: ["Base Color", "Roughness", "Normal"] },
  { id: "chinese-hackberry-bark", name: "Chinese Hackberry Bark", category: "wood", preset: "chinese-hackberry-bark", textures: ["Base Color", "Roughness", "Normal", "Ambient Occlusion"] },
  { id: "checkers", name: "Checkers", category: "tile", preset: "checkers", textures: ["Base Color", "Roughness"] },
  { id: "tile-test", name: "Tile Test", category: "tile", preset: "tile-test", textures: ["Base Color"] },
  { id: "voronoi-cells", name: "Voronoi Cells", category: "tile", preset: "voronoi-cells", textures: ["Base Color", "Roughness", "Normal"] },
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

// --- minimal PNG encoder (RGBA, no interlace) --------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePng(rgba, size) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
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
// bake/<preset>/renders/standard.png, via `npm run bake:server` + bakeMaterialTask). Materials without a
// render fall back to a deterministic gradient placeholder.
mkdirSync(outDir, { recursive: true });

const materials = MATERIALS.map((material) => {
  const render = join(root, "bake", material.preset, "renders", "standard.png");
  const dest = join(outDir, `${material.id}.png`);
  let thumbSource;
  if (existsSync(render)) {
    copyFileSync(render, dest);
    thumbSource = "render";
  } else {
    writeFileSync(dest, encodePng(renderPixels(material.id), SIZE));
    thumbSource = "placeholder";
  }

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
      thumbnail: `catalog/${material.id}.png`,
      nodeCount,
      textures: material.textures,
    },
    thumbSource,
  };
});

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
