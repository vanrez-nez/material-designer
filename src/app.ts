import * as THREE from "three";
import { WebGPURenderer, PMREMGenerator } from "three/webgpu";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { MainScene } from "./scene/main";
import { bakeService } from "@/runtime";
import { createExport } from "./debug/export";
import { installBakeDevHandles } from "./debug/bake-setup";
import { loadRendererConfig, setupTweakpane } from "./debug/tweakpane";
import {
  MATERIAL_DOCUMENT_LOAD_EVENT,
  MATERIAL_GRAPH_REBUILD_EVENT,
  type MaterialDocumentLoadEvent,
} from "./app-events";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Missing #app root element");
}

const canvas = app.querySelector<HTMLCanvasElement>(".scene");
const graphHost = app.querySelector<HTMLDivElement>(".graph-host");
const paneHost = app.querySelector<HTMLDivElement>(".pane-host");

if (!canvas || !graphHost || !paneHost) {
  throw new Error("Missing app elements");
}

const sceneCanvas = canvas;
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 30);
camera.position.set(0, 1.35, 7.2);

// Renderer config lives in the debug/tweakpane module (the Render tab owns it), but the renderer must be
// constructed with it before the pane exists — so load it here and hand the object to setupTweakpane.
const rendererConfig = loadRendererConfig();

const renderer = new WebGPURenderer({
  canvas: sceneCanvas,
  antialias: rendererConfig.antialias,
  samples: rendererConfig.antialias ? rendererConfig.samples : 0,
  alpha: true,
});
renderer.setPixelRatio(rendererConfig.pixelRatio);
renderer.toneMapping = THREE.ACESFilmicToneMapping; // default tone mapping (Scene panel can change it live)
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const controls = new OrbitControls(camera, sceneCanvas);
controls.enableDamping = true;
controls.target.set(-0.6, 0.45, 0);
controls.update();

const mainScene = new MainScene();

// Bake/export tooling (dev), bound to the renderer + material graph it renders against.
const exporter = createExport({
  renderer,
  registry: mainScene.materialController.getRegistry(),
  liveDocument: () => mainScene.materialController.document,
});

const { stats, refreshTexturePreview, materialEditor, rebuildEditor } = setupTweakpane({
  app,
  graphHost,
  paneHost,
  renderer,
  mainScene,
  rendererConfig,
  resize,
  exporter,
});

window.addEventListener(MATERIAL_DOCUMENT_LOAD_EVENT, (event) => {
  const { document: doc, filename } = (event as MaterialDocumentLoadEvent).detail;
  try {
    mainScene.materialController.loadDocument(doc);
    void mainScene.materialSurface.refresh().then(() => {
      rebuildEditor();
      resize();
      if (filename) console.info(`[material] Loaded ${filename}`);
    });
  } catch (err) {
    console.warn("[material] Failed to load document", err);
  }
});

window.addEventListener(MATERIAL_GRAPH_REBUILD_EVENT, () => {
  void mainScene.materialSurface.refresh().then(() => {
    rebuildEditor();
    resize();
  });
});

const timer = new THREE.Timer();
timer.connect(document);

function resize(): void {
  const { clientWidth, clientHeight } = sceneCanvas;
  renderer.setSize(clientWidth, clientHeight, false);
  camera.aspect = clientWidth / Math.max(clientHeight, 1);
  camera.updateProjectionMatrix();
}

function animate(timestamp?: number): void {
  stats.begin();
  timer.update(timestamp);

  mainScene.update();
  refreshTexturePreview();
  controls.update();
  // Skip the frame render while a bake is compiling pipelines: `renderer.compileAsync` mutates shared
  // renderer state, so rendering during its await window corrupts the output (black screen / broken
  // geometry). The canvas holds its last frame for the ~sub-second compile; the DOM UI stays responsive.
  if (!bakeService.rendererBusy) renderer.render(mainScene.scene, camera);
  stats.end();
}

window.addEventListener("resize", () => resize());

// WebGPURenderer initialises its backend asynchronously (unlike WebGLRenderer). Wait for it before
// the first render, then drive the loop via setAnimationLoop (the WebGPU-friendly RAF).
await renderer.init();
// Offline baking needs the renderer. Hand it to the shared bake service, then refresh the preview surface so
// it swaps from the live startup fallback to the baked offline material.
bakeService.attachRenderer(renderer);
await mainScene.materialSurface.refresh();

// Shared IBL environment: one RoomEnvironment PMREM cubemap gives the preview soft fill and reflections.
try {
  const pmrem = new PMREMGenerator(renderer);
  mainScene.scene.environment = pmrem.fromScene(new RoomEnvironment()).texture;
  mainScene.scene.environmentIntensity = 0.1; // matches the Scene tab's default envIntensity
  pmrem.dispose();
} catch (err) {
  // If PMREM generation fails on this backend, fall back to the flat ambient (kept low) so the scene
  // still lights — surfaced rather than silently flat.
  console.warn("[env] IBL setup failed; falling back to ambient light only", err);
}
const hasWebGPU = typeof navigator !== "undefined" && "gpu" in navigator;
stats.setRenderer(hasWebGPU ? "WebGPU" : "WebGL2");
resize();
renderer.setAnimationLoop(animate);

// Dev-only handles so the app can be driven/inspected from the console (and by automated checks)
// even when the tab is backgrounded and rAF is throttled. Tree-shaken out of production builds.
if (import.meta.env.DEV) {
  Object.assign(window as unknown as Record<string, unknown>, {
    __scene: mainScene,
    __renderer: renderer,
    __camera: camera,
    __controls: controls,
    __editor: materialEditor,
    __openEditor: rebuildEditor,
    __frame: () => {
      mainScene.update();
      renderer.render(mainScene.scene, camera);
    },
  });
  installBakeDevHandles({ mainScene, exporter });
}
