// One-off fixture generator for the "From Catalog" browser: writes a deterministic placeholder
// thumbnail PNG per catalog material into public/catalog/, and prints the recursive node count of each
// referenced preset (handy for filling catalog.json). No dependencies — a tiny PNG encoder over node:zlib.
//
// Usage: node scripts/gen-catalog-thumbs.mjs
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "catalog");
const SIZE = 256;

// Catalog materials → preset key used both for the thumbnail's color seed and the node-count report.
const MATERIALS = [
  { id: "cracked-clay", preset: "cracked-clay" },
  { id: "rock", preset: "rock" },
  { id: "asphalt", preset: "asphalt" },
  { id: "zinc", preset: "zinc" },
  { id: "rusty-metal", preset: "rusty-metal" },
  { id: "bark", preset: "bark" },
  { id: "wood-planks", preset: "wood-planks" },
  { id: "parquet", preset: "parquet" },
  { id: "chinese-hackberry-bark", preset: "chinese-hackberry-bark" },
  { id: "checkers", preset: "checkers" },
  { id: "tile-test", preset: "tile-test" },
  { id: "voronoi-cells", preset: "voronoi-cells" },
];

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

// --- minimal PNG encoder (RGBA, no interlace) ---
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

mkdirSync(outDir, { recursive: true });
const report = [];
for (const { id, preset } of MATERIALS) {
  writeFileSync(join(outDir, `${id}.png`), encodePng(renderPixels(id), SIZE));
  let nodes = 0;
  try {
    nodes = countNodes(JSON.parse(readFileSync(join(root, "src", "presets", `${preset}.json`), "utf8")));
  } catch {
    /* preset missing — leave 0 */
  }
  report.push({ id, preset, nodes });
}
console.log(`wrote ${MATERIALS.length} thumbnails → public/catalog/`);
console.table(report);
