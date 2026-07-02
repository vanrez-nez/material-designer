import * as THREE from "three";
import { WebGPURenderer, PMREMGenerator } from "three/webgpu";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { MainScene } from "./MainScene";
import { bakeService, PBR_SOCKETS, type MaterialValue } from "@/runtime";
import { createExport } from "@/debug/export";
import { installBakeDevHandles } from "@/debug/bake-setup";
import { loadRendererConfig, setupTweakpane } from "@/debug/tweakpane";
import type { MaterialAppServices } from "@/components/app/services";
import {
  MATERIAL_DOCUMENT_LOAD_EVENT,
  MATERIAL_GRAPH_PANE_MOUNT_EVENT,
  MATERIAL_GRAPH_REBUILD_EVENT,
  MATERIAL_PREVIEW_PANE_MOUNT_EVENT,
  type MaterialDocumentLoadEvent,
  type MaterialGraphPaneMountEvent,
  type MaterialPreviewPaneMountEvent,
} from "@/app-events";
import { useWorkspaceStore } from "@/store/app";

export async function bootApp(services: MaterialAppServices): Promise<void> {
const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Missing #app root element");
}

let sceneHost = app.querySelector<HTMLDivElement>(".scene-host") ?? document.createElement("div");
const graphHost = app.querySelector<HTMLDivElement>(".graph-host") ?? document.createElement("div");
let paneHost = app.querySelector<HTMLDivElement>(".pane-host") ?? document.createElement("div");

const sceneCanvas = document.createElement("canvas");
sceneCanvas.className = "scene";
sceneHost.appendChild(sceneCanvas);

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 30);
camera.position.set(0, 1.35, 7.2);

// Renderer config lives in the debug/tweakpane module (the Render tab owns it), but the renderer must be
// constructed with it before the pane exists — so load it here and hand the object to setupTweakpane.
const rendererConfig = loadRendererConfig();
const savedRendererConfig =
  useWorkspaceStore.getState().materialDocument.ui?.settings?.rendererConfig;
if (savedRendererConfig && typeof savedRendererConfig === "object") {
  Object.assign(rendererConfig, savedRendererConfig);
}

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

const timer = new THREE.Timer();
timer.connect(document);
let sceneRenderable = false;

const { stats, materialEditor, paneElement, rebuildEditor } = setupTweakpane({
  app,
  graphHost,
  paneHost,
  renderer,
  mainScene,
  rendererConfig,
  resize,
  exporter,
});

function attachPreviewHosts(nextSceneHost: HTMLDivElement, nextPaneHost: HTMLDivElement): void {
  sceneHost = nextSceneHost;
  paneHost = nextPaneHost;
  if (sceneCanvas.parentElement !== sceneHost) sceneHost.appendChild(sceneCanvas);
  if (paneElement.parentElement !== paneHost) paneHost.appendChild(paneElement);
  resize();
}

function attachGraphHost(nextGraphHost: HTMLDivElement): void {
  materialEditor.attachHost(nextGraphHost);
  rebuildEditor();
}

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
  rebuildEditor();
});

window.addEventListener(MATERIAL_PREVIEW_PANE_MOUNT_EVENT, (event) => {
  const { sceneHost: nextSceneHost, paneHost: nextPaneHost } =
    (event as MaterialPreviewPaneMountEvent).detail;
  attachPreviewHosts(nextSceneHost, nextPaneHost);
});

window.addEventListener(MATERIAL_GRAPH_PANE_MOUNT_EVENT, (event) => {
  attachGraphHost((event as MaterialGraphPaneMountEvent).detail.graphHost);
});

function resize(): boolean {
  const { clientWidth, clientHeight } = sceneCanvas;
  if (clientWidth <= 0 || clientHeight <= 0 || !sceneCanvas.isConnected) {
    sceneRenderable = false;
    return false;
  }
  renderer.setSize(clientWidth, clientHeight, false);
  camera.aspect = clientWidth / Math.max(clientHeight, 1);
  camera.updateProjectionMatrix();
  sceneRenderable = true;
  return true;
}

function animate(timestamp?: number): void {
  stats.begin();
  timer.update(timestamp);

  mainScene.update();
  controls.update();
  // Skip the frame render while a bake is compiling pipelines: `renderer.compileAsync` mutates shared
  // renderer state, so rendering during its await window corrupts the output (black screen / broken
  // geometry). The canvas holds its last frame for the ~sub-second compile; the DOM UI stays responsive.
  if (sceneRenderable && !bakeService.rendererBusy) renderer.render(mainScene.scene, camera);
  stats.end();
}

window.addEventListener("resize", () => resize());
const sceneResizeObserver = new ResizeObserver(() => resize());
sceneResizeObserver.observe(sceneCanvas);

// WebGPURenderer initialises its backend asynchronously (unlike WebGLRenderer). Wait for it before
// the first render, then drive the loop via setAnimationLoop (the WebGPU-friendly RAF).
await renderer.init();
// Offline baking needs the renderer. Hand it to the shared bake service, then refresh the preview surface so
// it swaps from the live startup fallback to the baked offline material.
bakeService.attachRenderer(renderer);
await mainScene.materialSurface.refresh();

// Expose the texture API only now — with the renderer attached and the first bake done. This flips the
// preview pane's `textureReady` signal, and its initial refresh reads are guaranteed a live renderer
// (before this, readImage would have resolved null and the empty result would have stuck until the next
// graph edit).
services.setTextureApi({
  exportTextureZip: ({ channels, size }) => exporter.exportTextureZip({ channels, size }),
  readConnectedTextureChannels: () => {
    const { bundle } = mainScene.materialController.compileBundle({ backend: "offline" });
    const present = bundle as Partial<Record<string, MaterialValue>>;
    return PBR_SOCKETS.filter((socket) => present[socket] !== undefined);
  },
  readTexturePreview: (channel, size) =>
    bakeService.readImage(mainScene.materialController, channel, size),
});

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
      if (resize()) renderer.render(mainScene.scene, camera);
    },
  });
  installBakeDevHandles({ mainScene, exporter });
}
}
