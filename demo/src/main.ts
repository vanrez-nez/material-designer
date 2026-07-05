// Standalone Material Designer runtime demo — renders material-graph documents on a lit mesh using the
// `material-designer-runtime` package directly (no editor). Everything here is plain three.js + WebGPU
// driving the MaterialGraphRuntime facade.
import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import {
  MaterialGraphRuntime,
  createDefaultMaterialDocument,
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

function setStatus(message: string): void {
  statusEl.textContent = message;
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

// --- runtime ---------------------------------------------------------------------------------------
const runtime = new MaterialGraphRuntime({ document: createDefaultMaterialDocument() })
  .setRenderer(renderer);

// The material object can be swapped on a structural rebuild — keep the mesh current.
runtime.surface.onRebuilt(() => applyMaterial());

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
async function loadDocument(document: MaterialGraphDocument): Promise<void> {
  setStatus("Baking…");
  try {
    runtime.setDocument(document);
    await runtime.refresh();
    applyMaterial();
    syncScaleControl(runtime.getDocument());
    setStatus(runtime.lastError ? `Error: ${runtime.lastError}` : "");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
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
    await loadDocument(await loadSampleDocument(sampleSelect.value));
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
});

geoButtons.sphere.addEventListener("click", () => setGeometry("sphere"));
geoButtons.box.addEventListener("click", () => setGeometry("box"));
geoButtons.plane.addEventListener("click", () => setGeometry("plane"));

resolutionSelect.addEventListener("change", async () => {
  setStatus("Baking…");
  runtime.setOutputResolution(Number(resolutionSelect.value));
  await runtime.refresh();
  applyMaterial();
  setStatus("");
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
  await runtime.refresh();
  applyMaterial();
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
