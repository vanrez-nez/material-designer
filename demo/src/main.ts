// Standalone Material Designer runtime demo — renders material-graph documents on a lit mesh using the
// `material-designer-runtime` package directly (no editor). Everything here is plain three.js + WebGPU
// driving the MaterialGraphRuntime facade.
import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import {
  MaterialGraphRuntime,
  createDefaultMaterialDocument,
  type BakeCacheMetrics,
  type GraphNode,
  type MaterialGraphDocument,
} from "material-designer-runtime";

type GeometryType = "sphere" | "box" | "plane";

// --- DOM -------------------------------------------------------------------------------------------
const app = document.getElementById("app") as HTMLDivElement;
const sampleSelect = document.getElementById("sample") as HTMLSelectElement;
const geoButtons: Record<GeometryType, HTMLButtonElement> = {
  sphere: document.getElementById("geo-sphere") as HTMLButtonElement,
  box: document.getElementById("geo-box") as HTMLButtonElement,
  plane: document.getElementById("geo-plane") as HTMLButtonElement,
};
const resolutionSelect = document.getElementById("resolution") as HTMLSelectElement;
const scaleGroup = document.getElementById("scale-group") as HTMLDivElement;
const scaleInput = document.getElementById("scale") as HTMLInputElement;
const loadButton = document.getElementById("load") as HTMLButtonElement;
const loadInput = document.getElementById("load-input") as HTMLInputElement;
const statusEl = document.getElementById("status") as HTMLSpanElement;
const cacheToggle = document.getElementById("cache-toggle") as HTMLButtonElement;
const cacheRebuild = document.getElementById("cache-rebuild") as HTMLButtonElement;
const cacheClear = document.getElementById("cache-clear") as HTMLButtonElement;
const cacheStatsEl = document.getElementById("cache-stats") as HTMLDivElement;

function setStatus(message: string, kind: "info" | "baked" | "restored" = "info"): void {
  statusEl.textContent = message;
  statusEl.dataset.kind = kind;
}

// --- sample catalog --------------------------------------------------------------------------------
// "Empty" is the runtime's built-in default (a bare Principled → Output); the rest are fetched from
// public/samples/ (copies of editor presets).
const SAMPLES: Array<{ label: string; file?: string }> = [
  { label: "Empty" },
  { label: "Checkers", file: "checkers.json" },
  { label: "Voronoi Cells", file: "voronoi-cells.json" },
  { label: "Bark", file: "bark.json" },
  { label: "Rock", file: "rock.json" },
];

for (const sample of SAMPLES) {
  const option = document.createElement("option");
  option.value = sample.label;
  option.textContent = sample.label;
  sampleSelect.appendChild(option);
}

async function loadSampleDocument(label: string): Promise<MaterialGraphDocument> {
  const sample = SAMPLES.find((entry) => entry.label === label);
  if (!sample?.file) return createDefaultMaterialDocument();
  const response = await fetch(`./samples/${sample.file}`);
  if (!response.ok) throw new Error(`Could not load sample "${label}" (${response.status})`);
  return (await response.json()) as MaterialGraphDocument;
}

// --- renderer + scene ------------------------------------------------------------------------------
const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f17);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(0, 0.4, 4);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;

const key = new THREE.DirectionalLight(0xffffff, 2.4);
key.position.set(3, 4, 5);
scene.add(key);
scene.add(new THREE.AmbientLight(0xffffff, 0.25));

// --- preview mesh ----------------------------------------------------------------------------------
// The surface's ambient-occlusion node samples a `vertexAo` attribute; without it AO reads black. Fill
// it with 1 (fully lit) like the editor's MainScene does.
function addFullVertexAo(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const count = geometry.getAttribute("position").count;
  geometry.setAttribute("vertexAo", new THREE.Float32BufferAttribute(new Float32Array(count).fill(1), 1));
  return geometry;
}

function makeGeometry(type: GeometryType): THREE.BufferGeometry {
  if (type === "box") return addFullVertexAo(new THREE.BoxGeometry(1.6, 1.6, 1.6));
  if (type === "plane") return addFullVertexAo(new THREE.PlaneGeometry(2.6, 2.6));
  return addFullVertexAo(new THREE.SphereGeometry(1, 96, 48));
}

let geometryType: GeometryType = "sphere";
const mesh = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(
  makeGeometry(geometryType),
  new THREE.MeshStandardMaterial(),
);
scene.add(mesh);

function applyMaterial(): void {
  mesh.material = runtime.getNodeMaterial();
}

function setGeometry(type: GeometryType): void {
  geometryType = type;
  mesh.geometry.dispose();
  mesh.geometry = makeGeometry(type);
  for (const [name, button] of Object.entries(geoButtons)) {
    button.dataset.active = String(name === type);
  }
}

// --- persistent texture cache ----------------------------------------------------------------------
// The cache stores baked channel texels in IndexedDB and, on a hit, restores them with a GPU-to-GPU copy
// that short-circuits BEFORE shader compilation — which is what actually makes a bake slow. It is opt-in,
// so the demo remembers your choice across reloads: that is the only way to see the interesting case,
// where a material you baked in a PREVIOUS session comes back without compiling anything.
//
// Try it: enable the cache, pick "Rock" (a heavy graph), wait for the bake, then switch to another sample
// and back — or just reload the page. The status readout tells you which path each load took.
const CACHE_PREF_KEY = "md-demo-cache-enabled";
const cacheEnabledPref = localStorage.getItem(CACHE_PREF_KEY) === "true";

// --- runtime ---------------------------------------------------------------------------------------
const runtime = new MaterialGraphRuntime({
  document: createDefaultMaterialDocument(),
  cache: {
    enabled: cacheEnabledPref,
    // Demo-tuned, so every sample is cacheable and a quick click-through still persists. The library
    // defaults (minBakeMs 250, writeDelayMs 750) are the sensible production values — they avoid spending
    // disk on bakes too cheap to be worth caching, and avoid a readback per tick during a slider drag.
    minBakeMs: 0,
    writeDelayMs: 300,
  },
}).setRenderer(renderer);

// The material object can be swapped on a structural rebuild — keep the mesh current.
runtime.surface.onRebuilt(() => applyMaterial());

// How the last load resolved. The bake service reports a "restore" phase when texels came from the cache
// instead of being rendered, which is the honest signal — timing alone can't tell you, since a warm shader
// pipeline also makes a real bake fast.
let lastLoadWasRestore = false;
runtime.service.onBakeReport((report) => {
  if (report.phase === "restore") lastLoadWasRestore = true;
});

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function refreshCacheStats(): Promise<void> {
  const metrics: BakeCacheMetrics | null = await runtime.cacheMetrics();
  if (!metrics || !metrics.enabled) {
    cacheStatsEl.innerHTML = `<span class="off">cache off — enable it to persist bakes across reloads</span>`;
    return;
  }
  const quota = metrics.quota
    ? `  quota ${formatBytes(metrics.quota.usage)} / ${formatBytes(metrics.quota.quota)}`
    : "";
  cacheStatsEl.innerHTML =
    `store <b>${metrics.store}</b>  encoding <b>${metrics.encoding}</b>\n` +
    `entries <b>${metrics.entries}</b>  size <b>${formatBytes(metrics.bytes)}</b>` +
    ` / ${formatBytes(metrics.budgetBytes)}${quota}\n` +
    `hits <b>${metrics.hits}</b>  misses <b>${metrics.misses}</b>` +
    `  writes <b>${metrics.writes}</b>  evictions <b>${metrics.evictions}</b>` +
    (metrics.lastError ? `\nlast error: ${metrics.lastError}` : "");
}

function syncCacheToggle(): void {
  const on = runtime.cacheEnabled;
  cacheToggle.textContent = on ? "On" : "Off";
  cacheToggle.dataset.active = String(on);
  cacheToggle.setAttribute("aria-pressed", String(on));
  cacheRebuild.disabled = !on;
  cacheClear.disabled = !on;
}

// --- scale slider (live setNodeParam demo) ---------------------------------------------------------
// Bind the slider to the first top-level node exposing a numeric `scale` param (setNodeParam targets
// top-level nodes). Hidden when the current document has none.
let scaleTarget: { nodeId: string; key: string } | null = null;

function findScaleParam(document: MaterialGraphDocument): { nodeId: string; key: string } | null {
  for (const node of document.nodes as GraphNode[]) {
    const value = node.params?.scale;
    if (typeof value === "number") return { nodeId: node.id, key: "scale" };
  }
  return null;
}

function syncScaleControl(document: MaterialGraphDocument): void {
  scaleTarget = findScaleParam(document);
  scaleGroup.hidden = scaleTarget === null;
  if (scaleTarget) {
    const current = (document.nodes as GraphNode[]).find((n) => n.id === scaleTarget!.nodeId)?.params
      ?.scale;
    if (typeof current === "number") scaleInput.value = String(current);
  }
}

// --- document loading ------------------------------------------------------------------------------
async function loadDocument(document: MaterialGraphDocument, label = ""): Promise<void> {
  setStatus("Baking…");
  try {
    runtime.setDocument(document);
    await refreshAndReport(label);
    syncScaleControl(runtime.getDocument());
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
}

// Bake (or restore) the current document and say which happened, with the wall time. This is the whole
// point of the demo: the same material either compiles shaders or doesn't, and you can watch the difference.
async function refreshAndReport(label = ""): Promise<void> {
  lastLoadWasRestore = false;
  const started = performance.now();
  await runtime.refresh();
  await runtime.whenIdle();
  const ms = Math.round(performance.now() - started);
  applyMaterial();
  if (runtime.lastError) {
    setStatus(`Error: ${runtime.lastError}`);
  } else {
    const prefix = label ? `${label} — ` : "";
    setStatus(
      lastLoadWasRestore ? `${prefix}restored from cache in ${ms} ms` : `${prefix}baked in ${ms} ms`,
      lastLoadWasRestore ? "restored" : "baked",
    );
  }
  // The capture is deferred (writeDelayMs) so it never lands inside an edit burst; wait for it so the
  // stats below reflect what is actually stored rather than what is about to be.
  await runtime.flushCache();
  await refreshCacheStats();
}

function isMaterialGraphDocument(value: unknown): value is MaterialGraphDocument {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    Array.isArray((value as MaterialGraphDocument).nodes) &&
    Array.isArray((value as MaterialGraphDocument).edges)
  );
}

// --- toolbar wiring --------------------------------------------------------------------------------
sampleSelect.addEventListener("change", async () => {
  try {
    setStatus("Loading…");
    const label = sampleSelect.value;
    await loadDocument(await loadSampleDocument(label), label);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
});

geoButtons.sphere.addEventListener("click", () => setGeometry("sphere"));
geoButtons.box.addEventListener("click", () => setGeometry("box"));
geoButtons.plane.addEventListener("click", () => setGeometry("plane"));

resolutionSelect.addEventListener("change", async () => {
  setStatus("Baking…");
  // Bake size is part of the cache key, so each resolution gets its own entry — flip between two and the
  // second visit to either is a restore.
  runtime.setOutputResolution(Number(resolutionSelect.value));
  await refreshAndReport(`${resolutionSelect.value}px`);
});

// --- cache controls ---------------------------------------------------------------------------------
cacheToggle.addEventListener("click", async () => {
  const next = !runtime.cacheEnabled;
  runtime.setCacheEnabled(next);
  localStorage.setItem(CACHE_PREF_KEY, String(next));
  syncCacheToggle();
  if (next) {
    // Nothing is stored for the current document yet — bake once so there is something to restore.
    await refreshAndReport();
  } else {
    setStatus("cache disabled");
    await refreshCacheStats();
  }
});

cacheRebuild.addEventListener("click", async () => {
  setStatus("Rebuilding cache…");
  const started = performance.now();
  // Deletes this document's entry, re-bakes for REAL (the read is bypassed), and resolves only once the
  // fresh entry is durably written.
  await runtime.rebuildCache();
  applyMaterial();
  setStatus(`cache rebuilt in ${Math.round(performance.now() - started)} ms`, "baked");
  await refreshCacheStats();
});

cacheClear.addEventListener("click", async () => {
  await runtime.clearCache();
  setStatus("cache cleared — the next load will bake");
  await refreshCacheStats();
});

// A capture is deferred by writeDelayMs, so a fast reload could otherwise lose the most recent bake.
// `flushCache()` forces it out on the way off the page.
window.addEventListener("pagehide", () => {
  void runtime.flushCache();
});

scaleInput.addEventListener("input", () => {
  if (!scaleTarget) return;
  runtime.setNodeParam(scaleTarget.nodeId, scaleTarget.key, Number(scaleInput.value));
});

loadButton.addEventListener("click", () => loadInput.click());
loadInput.addEventListener("change", async () => {
  const file = loadInput.files?.[0];
  loadInput.value = "";
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text()) as unknown;
    if (!isMaterialGraphDocument(parsed)) throw new Error("Not a Material Designer document (needs nodes/edges).");
    sampleSelect.value = "";
    await loadDocument(parsed);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
});

// --- resize + loop ---------------------------------------------------------------------------------
function resize(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height);
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);

async function main(): Promise<void> {
  await renderer.init();

  // Shared IBL environment (soft fill + reflections), matching the editor's look.
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment()).texture;
    scene.environmentIntensity = 0.6;
    pmrem.dispose();
  } catch {
    // If PMREM fails on this backend, the directional + ambient rig still lights the mesh.
  }

  resize();
  syncCacheToggle();
  await refreshAndReport(sampleSelect.value);
  syncScaleControl(runtime.getDocument());

  renderer.setAnimationLoop(() => {
    controls.update();
    // Skip rendering while the runtime is baking — rendering mid-bake would submit a texture being
    // resized/recreated ("Destroyed texture used in a submit"). The canvas holds its last frame for the
    // sub-second bake. `runtime.busy` covers the whole rebuild (resize + bake).
    if (!runtime.busy) renderer.render(scene, camera);
  });
}

void main();
