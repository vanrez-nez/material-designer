import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { Pane, type FolderApi } from "tweakpane";
import {
  MaterialBakeService,
  MaterialGraphRuntime,
  countGraphNodes,
  type BakeCacheChannel,
  type BakeReport,
  type BakeTimingBreakdown,
  type MaterialGraphDocument,
} from "material-designer-runtime";
import { MATERIAL_PRESETS, makePreset } from "@/presets";
import { StatsPanePluginBundle, type StatsPaneApi } from "./tweak-pane/stats-blade";
import "./performance.css";

const VALID_RESOLUTIONS = [256, 512, 1024, 2048] as const;
const DEFAULT_RESOLUTION = 1024;
const GRID_COLUMNS = 5;
const GRID_SPACING = 2.7;

type BenchmarkStatus = "ready" | "error";

interface MaterialReadout {
  status: string;
  generation: string;
  ready: string;
  channels: string;
  resolution: string;
  nodes: string;
  setup: string;
  queue: string;
  graph: string;
  intermediate: string;
  shaders: string;
  dispatch: string;
  restore: string;
  gpu: string;
  surface: string;
  release: string;
}

interface MaterialBenchmarkResult {
  id: string;
  label: string;
  status: BenchmarkStatus;
  nodeCount: number;
  resolution: number;
  channels: BakeCacheChannel[];
  setupMs: number;
  timings: BakeTimingBreakdown | null;
  surfaceCompileMs: number;
  releaseCachesMs: number;
  readyMs: number;
  error?: string;
}

interface MaterialPerformanceSnapshot {
  version: 2;
  generatedAt: string;
  resolution: number;
  cacheEnabled: false;
  coldRunId: string;
  shaderCacheBust: true;
  batchWallMs: number;
  results: MaterialBenchmarkResult[];
}

declare global {
  interface Window {
    __materialPerformance?: MaterialPerformanceSnapshot;
  }
}

const app = document.getElementById("app") as HTMLElement;
const paneHost = document.getElementById("pane") as HTMLElement;
const resolution = readResolution();
const coldRunId = createColdRunId();
publishColdRunId();

if (MATERIAL_PRESETS.length < 10) {
  throw new Error(`Performance demo requires at least 10 presets; found ${MATERIAL_PRESETS.length}.`);
}

const pane = new Pane({
  container: paneHost,
  expanded: true,
  title: "Material performance",
});
pane.registerPlugin(StatsPanePluginBundle);

const stats = pane.addBlade({ view: "stats", label: "Frame statistics" }) as unknown as StatsPaneApi;
stats.setRenderer("WebGPU");

const controls = {
  resolution,
  labels: true,
};
const benchmarkFolder = pane.addFolder({ title: "Benchmark", expanded: true });
benchmarkFolder.addBinding(controls, "resolution", {
  label: "Resolution",
  options: {
    "256 px": 256,
    "512 px": 512,
    "1024 px": 1024,
    "2048 px": 2048,
  },
});
benchmarkFolder.addBinding(controls, "labels", { label: "Names" }).on("change", (event) => {
  const labels = app.querySelector<HTMLElement>(".labels-layer");
  if (labels) labels.hidden = !event.value;
});
benchmarkFolder.addButton({ title: "Reload benchmark" }).on("click", () => {
  const url = new URL(window.location.href);
  url.searchParams.set("resolution", String(controls.resolution));
  // Keep the current id in the navigation URL so createColdRunId() can prove the next one differs. A normal
  // Cmd-R follows the same path. Explicitly reload when neither the resolution nor URL needs to change.
  if (url.href === window.location.href) window.location.reload();
  else window.location.assign(url);
});

const summary = {
  status: "Initializing WebGPU…",
  completed: `0 / ${MATERIAL_PRESETS.length}`,
  resolution: `${resolution} × ${resolution}`,
  cacheMode: "Cold · WGSL cache-busted",
  coldRun: coldRunId,
  rendererInit: "—",
  batchWall: "—",
  generation: "—",
  average: "—",
};
const summaryFolder = pane.addFolder({ title: "Summary", expanded: true });
summaryFolder.addBinding(summary, "status", { label: "Status", readonly: true });
summaryFolder.addBinding(summary, "completed", { label: "Completed", readonly: true });
summaryFolder.addBinding(summary, "resolution", { label: "Resolution", readonly: true });
summaryFolder.addBinding(summary, "cacheMode", { label: "Cache mode", readonly: true });
summaryFolder.addBinding(summary, "coldRun", { label: "Cold run", readonly: true });
summaryFolder.addBinding(summary, "rendererInit", { label: "WebGPU init", readonly: true });
summaryFolder.addBinding(summary, "batchWall", { label: "Batch wall", readonly: true });
summaryFolder.addBinding(summary, "generation", { label: "Generation sum", readonly: true });
summaryFolder.addBinding(summary, "average", { label: "Average", readonly: true });

const readouts = new Map<string, MaterialReadout>();
for (const [index, preset] of MATERIAL_PRESETS.entries()) {
  const readout = emptyReadout(resolution);
  readouts.set(preset.key, readout);
  const folder = pane.addFolder({
    title: `${String(index + 1).padStart(2, "0")} · ${preset.label}`,
    expanded: false,
  });
  bindReadout(folder, readout);
}

const results: MaterialBenchmarkResult[] = [];
let batchStartedAt = 0;

function readResolution(): number {
  const candidate = Number(new URLSearchParams(window.location.search).get("resolution"));
  return VALID_RESOLUTIONS.includes(candidate as (typeof VALID_RESOLUTIONS)[number])
    ? candidate
    : DEFAULT_RESOLUTION;
}

function createColdRunId(): string {
  const previous = new URLSearchParams(window.location.search).get("cold");
  let next: string;
  do {
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    next = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  } while (next === previous);
  return next;
}

function publishColdRunId(): void {
  const url = new URL(window.location.href);
  url.searchParams.set("cold", coldRunId);
  window.history.replaceState(window.history.state, "", url);
}

function emptyReadout(size: number): MaterialReadout {
  return {
    status: "Pending",
    generation: "—",
    ready: "—",
    channels: "—",
    resolution: `${size} × ${size}`,
    nodes: "—",
    setup: "—",
    queue: "—",
    graph: "—",
    intermediate: "—",
    shaders: "—",
    dispatch: "—",
    restore: "—",
    gpu: "—",
    surface: "—",
    release: "—",
  };
}

function bindReadout(folder: FolderApi, readout: MaterialReadout): void {
  folder.addBinding(readout, "status", { label: "Status", readonly: true });
  folder.addBinding(readout, "generation", { label: "Generation", readonly: true });
  folder.addBinding(readout, "ready", { label: "Ready total", readonly: true });
  folder.addBinding(readout, "channels", { label: "Channels", readonly: true });
  folder.addBinding(readout, "resolution", { label: "Resolution", readonly: true });
  folder.addBinding(readout, "nodes", { label: "Nodes", readonly: true });
  folder.addBinding(readout, "setup", { label: "Setup", readonly: true });
  folder.addBinding(readout, "queue", { label: "Queue wait", readonly: true });
  folder.addBinding(readout, "graph", { label: "Graph compile", readonly: true });
  folder.addBinding(readout, "intermediate", { label: "Cache dispatch", readonly: true });
  folder.addBinding(readout, "shaders", { label: "Shader compile", readonly: true });
  folder.addBinding(readout, "dispatch", { label: "Channel dispatch", readonly: true });
  folder.addBinding(readout, "restore", { label: "Cache restore", readonly: true });
  folder.addBinding(readout, "gpu", { label: "GPU wait", readonly: true });
  folder.addBinding(readout, "surface", { label: "Surface compile", readonly: true });
  folder.addBinding(readout, "release", { label: "Release caches", readonly: true });
}

function formatMs(value: number): string {
  return `${value.toFixed(1)} ms`;
}

function formatChannels(channels: readonly BakeCacheChannel[]): string {
  return channels.length > 0 ? channels.join(", ") : "none";
}

function documentAtResolution(id: string, size: number): MaterialGraphDocument {
  const document = makePreset(id);
  const output = document.nodes.find((node) => node.type === "material-output");
  if (!output) throw new Error(`Preset "${id}" has no Material Output node.`);
  output.params.outputResolution = String(size);
  return document;
}

function applyBakeReport(report: BakeReport): void {
  if (!report.source) return;
  const readout = readouts.get(report.source);
  if (!readout) return;

  readout.nodes = String(report.nodeCount);
  readout.resolution = `${report.resolution} × ${report.resolution}`;
  readout.channels = formatChannels(report.channels);
  readout.queue = formatMs(report.timings.queueWaitMs);
  readout.graph = formatMs(report.timings.graphCompileMs);
  readout.intermediate = formatMs(report.timings.cacheDispatchMs);
  readout.shaders = formatMs(report.timings.pipelineCompileMs);
  readout.dispatch = formatMs(report.timings.channelDispatchMs);
  readout.restore = formatMs(report.timings.cacheRestoreMs);
  readout.gpu = formatMs(report.timings.gpuWaitMs);

  if (report.phase === "nodes") readout.status = "Graph compiled";
  if (report.phase === "shaders") readout.status = "Compiling shaders…";
  if (report.phase === "render") readout.status = "Rendering channels…";
  if (report.phase === "restore") readout.status = "Restoring cache…";
  if (report.phase === "done") {
    readout.status = "Preparing surface…";
    readout.generation = formatMs(report.timings.generationMs);
  }
  pane.refresh();
}

function updateSummary(current?: string): void {
  const ready = results.filter((result) => result.status === "ready");
  const generationMs = ready.reduce((total, result) => total + (result.timings?.generationMs ?? 0), 0);
  summary.completed = `${results.length} / ${MATERIAL_PRESETS.length}`;
  summary.batchWall = batchStartedAt > 0 ? formatMs(performance.now() - batchStartedAt) : "—";
  summary.generation = ready.length > 0 ? formatMs(generationMs) : "—";
  summary.average = ready.length > 0 ? formatMs(generationMs / ready.length) : "—";
  if (current) summary.status = current;
  pane.refresh();
}

function publishSnapshot(): void {
  const batchWallMs = batchStartedAt > 0 ? performance.now() - batchStartedAt : 0;
  window.__materialPerformance = {
    version: 2,
    generatedAt: new Date().toISOString(),
    resolution,
    cacheEnabled: false,
    coldRunId,
    shaderCacheBust: true,
    batchWallMs,
    results: results.map((result) => ({
      ...result,
      channels: [...result.channels],
      timings: result.timings ? { ...result.timings } : null,
    })),
  };
}

function printResults(): void {
  console.info(`[performance] cold run ${coldRunId} (persistent textures off, unique WGSL identity)`);
  console.table(
    results.map((result) => ({
      material: result.label,
      status: result.status,
      generationMs: result.timings?.generationMs.toFixed(1) ?? "—",
      readyMs: result.readyMs.toFixed(1),
      channels: formatChannels(result.channels),
      resolution: result.resolution,
      error: result.error ?? "",
    })),
  );
  console.info("Full material performance report: window.__materialPerformance");
}

function addVertexAo(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const vertexCount = geometry.getAttribute("position").count;
  geometry.setAttribute(
    "vertexAo",
    new THREE.Float32BufferAttribute(new Float32Array(vertexCount).fill(1), 1),
  );
  return geometry;
}

async function main(): Promise<void> {
  if (!("gpu" in navigator)) throw new Error("WebGPU is unavailable in this browser.");

  const renderer = new THREE.WebGPURenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  app.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = "labels-layer";
  Object.assign(labelRenderer.domElement.style, {
    position: "absolute",
    inset: "0",
    pointerEvents: "none",
  });
  app.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0d12);

  const rows = Math.ceil(MATERIAL_PRESETS.length / GRID_COLUMNS);
  const gridWidth = (Math.min(GRID_COLUMNS, MATERIAL_PRESETS.length) - 1) * GRID_SPACING;
  const gridDepth = (rows - 1) * GRID_SPACING;
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, Math.max(7, rows * 3.4), Math.max(13, gridWidth * 1.05));

  const controls3d = new OrbitControls(camera, renderer.domElement);
  controls3d.target.set(0, 0.8, 0);
  controls3d.enableDamping = true;
  controls3d.minDistance = 5;
  controls3d.maxDistance = 35;
  controls3d.maxPolarAngle = Math.PI * 0.49;

  const geometry = addVertexAo(new THREE.SphereGeometry(1, 96, 48));
  const placeholderMaterial = new THREE.MeshStandardMaterial({ color: 0x29313d, roughness: 0.8 });
  const meshes = new Map<string, THREE.Mesh<THREE.BufferGeometry, THREE.Material>>();
  const labelElements = new Map<string, HTMLElement>();

  for (const [index, preset] of MATERIAL_PRESETS.entries()) {
    const column = index % GRID_COLUMNS;
    const row = Math.floor(index / GRID_COLUMNS);
    const mesh = new THREE.Mesh(geometry, placeholderMaterial);
    mesh.position.set(
      column * GRID_SPACING - gridWidth / 2,
      1.1,
      row * GRID_SPACING - gridDepth / 2,
    );
    const labelElement = document.createElement("div");
    labelElement.className = "material-label";
    labelElement.dataset.state = "pending";
    labelElement.textContent = preset.label;
    const label = new CSS2DObject(labelElement);
    label.position.set(0, -1.35, 0);
    mesh.add(label);
    scene.add(mesh);
    meshes.set(preset.key, mesh);
    labelElements.set(preset.key, labelElement);
  }

  const groundGeometry = new THREE.PlaneGeometry(gridWidth + 5, gridDepth + 6);
  const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x111720, roughness: 0.92 });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
  keyLight.position.set(6, 10, 8);
  scene.add(keyLight, new THREE.AmbientLight(0xffffff, 0.22));

  const initStartedAt = performance.now();
  await renderer.init();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environmentTarget = pmrem.fromScene(new RoomEnvironment());
  scene.environment = environmentTarget.texture;
  scene.environmentIntensity = 0.65;
  pmrem.dispose();
  summary.rendererInit = formatMs(performance.now() - initStartedAt);
  pane.refresh();

  const bakeService = new MaterialBakeService();
  const unsubscribeReports = bakeService.onBakeReport(applyBakeReport);
  const runtimes: MaterialGraphRuntime[] = [];
  let renderBlocked = true;

  const resize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height);
    labelRenderer.setSize(width, height);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener("resize", resize);

  renderer.setAnimationLoop(() => {
    controls3d.update();
    if (renderBlocked || bakeService.rendererBusy) return;
    stats.begin();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
    stats.end();
  });

  batchStartedAt = performance.now();
  updateSummary("Loading all presets…");

  for (const preset of MATERIAL_PRESETS) {
    const readout = readouts.get(preset.key)!;
    const mesh = meshes.get(preset.key)!;
    const labelElement = labelElements.get(preset.key)!;
    const materialStartedAt = performance.now();
    let runtime: MaterialGraphRuntime | null = null;
    let setupMs = 0;
    let surfaceCompileMs = 0;
    let releaseCachesMs = 0;
    let latestReport: BakeReport | null = null;
    const unsubscribeMaterialReport = bakeService.onBakeReport((report) => {
      if (report.source === preset.key && report.phase === "done") latestReport = report;
    });

    try {
      readout.status = "Setting up…";
      updateSummary(`Loading ${preset.label}…`);
      const setupStartedAt = performance.now();
      const document = documentAtResolution(preset.key, resolution);
      const nodeCount = countGraphNodes(document);
      runtime = new MaterialGraphRuntime({
        bakeService,
        cache: false,
        document,
        source: preset.key,
        shaderCacheNonce: coldRunId,
      }).setRenderer(renderer);
      runtimes.push(runtime);
      setupMs = performance.now() - setupStartedAt;
      readout.nodes = String(nodeCount);
      readout.setup = formatMs(setupMs);
      readout.status = "Queued…";
      pane.refresh();

      await runtime.refresh();
      await runtime.whenIdle();
      if (runtime.lastError) throw new Error(runtime.lastError);
      if (!latestReport) throw new Error("Bake completed without a telemetry report.");

      mesh.material = runtime.getNodeMaterial();
      const surfaceStartedAt = performance.now();
      await renderer.compileAsync(mesh, camera, scene);
      surfaceCompileMs = performance.now() - surfaceStartedAt;
      readout.surface = formatMs(surfaceCompileMs);

      const releaseStartedAt = performance.now();
      await runtime.releaseCaches();
      releaseCachesMs = performance.now() - releaseStartedAt;
      const readyMs = performance.now() - materialStartedAt;
      const report = latestReport as BakeReport;
      readout.release = formatMs(releaseCachesMs);
      readout.ready = formatMs(readyMs);
      readout.status = "Ready";
      labelElement.dataset.state = "ready";
      results.push({
        id: preset.key,
        label: preset.label,
        status: "ready",
        nodeCount,
        resolution: report.resolution,
        channels: [...report.channels],
        setupMs,
        timings: { ...report.timings },
        surfaceCompileMs,
        releaseCachesMs,
        readyMs,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const readyMs = performance.now() - materialStartedAt;
      if (runtime) {
        mesh.material = placeholderMaterial;
        runtime.dispose();
        const runtimeIndex = runtimes.indexOf(runtime);
        if (runtimeIndex >= 0) runtimes.splice(runtimeIndex, 1);
      }
      readout.status = `Error: ${message}`;
      readout.ready = formatMs(readyMs);
      labelElement.dataset.state = "error";
      results.push({
        id: preset.key,
        label: preset.label,
        status: "error",
        nodeCount: Number(readout.nodes) || 0,
        resolution,
        channels: [],
        setupMs,
        timings: null,
        surfaceCompileMs,
        releaseCachesMs,
        readyMs,
        error: message,
      });
      console.error(`[performance] ${preset.label}:`, error);
    } finally {
      unsubscribeMaterialReport();
      publishSnapshot();
      updateSummary();
    }
  }

  renderBlocked = false;
  const failures = results.filter((result) => result.status === "error").length;
  updateSummary(failures > 0 ? `Complete with ${failures} error${failures === 1 ? "" : "s"}` : "Complete");
  publishSnapshot();
  printResults();

  window.addEventListener(
    "pagehide",
    () => {
      renderer.setAnimationLoop(null);
      window.removeEventListener("resize", resize);
      unsubscribeReports();
      controls3d.dispose();
      for (const runtime of runtimes) runtime.dispose();
      geometry.dispose();
      placeholderMaterial.dispose();
      groundGeometry.dispose();
      groundMaterial.dispose();
      environmentTarget.dispose();
      renderer.dispose();
      labelRenderer.domElement.remove();
      pane.dispose();
    },
    { once: true },
  );
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  summary.status = `Error: ${message}`;
  pane.refresh();
  console.error("[performance] benchmark failed:", error);
});
