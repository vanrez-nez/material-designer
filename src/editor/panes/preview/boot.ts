import * as THREE from "three";
import { WebGPURenderer, PMREMGenerator } from "three/webgpu";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { MainScene } from "./MainScene";
import { bakeService } from "@/runtime";
import { createExport } from "@/debug/export";
import { installBakeDevHandles } from "@/debug/bake-setup";
import { loadRendererConfig, setupTweakpane } from "@/debug/tweakpane";
import { createFrameScheduler } from "@/lib/frame-scheduler";
import type { MaterialAppServices } from "@/components/app/services";
import {
  GRAPH_NAVIGATE_EVENT,
  MATERIAL_DOCUMENT_LOAD_EVENT,
  MATERIAL_GRAPH_PANE_MOUNT_EVENT,
  MATERIAL_GRAPH_REBUILD_EVENT,
  MATERIAL_PREVIEW_PANE_MOUNT_EVENT,
  type GraphNavigateEvent,
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

let sceneRenderable = false;

// On-demand rendering: the scene is static (no animation), so instead of a continuous rAF loop we render
// once per meaningful change — camera interaction, a material bake/rebuild, a scene/lighting tweak, a
// resize, or a document load. `requestRender` coalesces bursts into a single rAF-timed frame. These are
// declared before setupTweakpane because it applies saved settings synchronously (→ resize → requestRender).
let rendererReady = false; // flipped true after renderer.init(); guards early rAFs (resize runs pre-init)
function renderNow(): void {
  if (!rendererReady || !sceneRenderable) return;
  // Two gates. `rendererBusy`: `renderer.compileAsync` mutates shared renderer state during its await
  // window, so rendering then corrupts the output. `materialSurface.busy`: an in-place texture resize is
  // mid-flight and rendering would submit a destroyed texture. In both cases skip now and re-render once
  // the surface reports idle — the canvas holds its last frame meanwhile.
  if (bakeService.rendererBusy || mainScene.materialSurface.busy) {
    void mainScene.materialSurface.whenIdle().then(requestRender);
    return;
  }
  mainScene.update();
  renderer.render(mainScene.scene, camera);
}
// Shared coalescing scheduler (also used by the texture preview) — collapses a burst of change events into
// one rAF-timed render instead of a continuous loop.
const frameScheduler = createFrameScheduler(renderNow);
function requestRender(): void {
  frameScheduler.request();
}

// OrbitControls has damping (inertial glide after release), which needs a frame-by-frame render until it
// settles. Render whenever the controls report the camera moved — this is the canonical on-demand hook and
// it covers ALL paths, including wheel-zoom: OrbitControls' wheel handler applies the dolly via its own
// internal `update()` (between its synchronous "start"/"end"), so the change happens outside our pump loop;
// a loop that only rendered on its own `update()` motion would miss it (the scroll wouldn't update the view).
controls.addEventListener("change", requestRender);

// Damping only advances when `controls.update()` is called, so pump it every frame for the whole gesture
// (start→end) and until the inertial glide settles. `update()` dispatches "change" (→ requestRender) when it
// actually moves, so the pump itself doesn't render. Keeping it alive while the pointer is held
// (`interacting`) means holding still mid-drag then moving again isn't dropped. Idle between interactions =
// zero rAF (nothing calls `update()`, so no "change" fires).
let interacting = false;
let controlsRaf = 0;
function pumpControls(): void {
  const moving = controls.update();
  controlsRaf = interacting || moving ? requestAnimationFrame(pumpControls) : 0;
}
controls.addEventListener("start", () => {
  interacting = true;
  if (!controlsRaf) controlsRaf = requestAnimationFrame(pumpControls);
});
controls.addEventListener("end", () => {
  interacting = false; // let the pump run out as damping settles, then stop
});

const { materialEditor, paneElement, rebuildEditor } = setupTweakpane({
  app,
  graphHost,
  paneHost,
  renderer,
  mainScene,
  rendererConfig,
  resize,
  requestRender,
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
      requestRender();
      if (filename) console.info(`[material] Loaded ${filename}`);
    });
  } catch (err) {
    console.warn("[material] Failed to load document", err);
  }
});

window.addEventListener(MATERIAL_GRAPH_REBUILD_EVENT, () => {
  rebuildEditor();
});

// Group-navigation from the React pane-title breadcrumb: exit the trail to the requested depth.
window.addEventListener(GRAPH_NAVIGATE_EVENT, (event) => {
  mainScene.materialController.exitToDepth((event as GraphNavigateEvent).detail.depth);
  rebuildEditor();
  requestRender();
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
  requestRender();
  return true;
}

window.addEventListener("resize", () => resize());
const sceneResizeObserver = new ResizeObserver(() => resize());
sceneResizeObserver.observe(sceneCanvas);

// WebGPURenderer initialises its backend asynchronously (unlike WebGLRenderer). Wait for it before
// the first render.
await renderer.init();
rendererReady = true;
// three's WebGPURenderer starts an internal, always-on rAF loop inside init() (Animation.start) that ticks
// `nodeFrame.update()` every frame for the renderer's lifetime — so even with our on-demand rendering and a
// fully static scene the tab never idles (~7% CPU, a tiny three.webgpu render every frame). `setAnimationLoop
// (null)` does NOT stop it; only `dispose()` does. We have no time-based/animated nodes, and `render()` drives
// node updates per call (via renderId) — baking still ticks the frame through `compileAsync` — so we cancel
// the internal loop and let our on-demand renders drive everything. Idle = zero rAF.
(renderer as unknown as { _animation?: { stop(): void } })._animation?.stop();
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
  // The connected channels are exactly what the surface baked — read them from the set instead of
  // recompiling a bundle just to list presence.
  readConnectedTextureChannels: () => [...mainScene.materialSurface.presentChannels()],
  // GPU-direct preview: the pane samples these baked textures directly (no readImage, no readback).
  getChannelTexture: (channel) => mainScene.materialSurface.getChannelTexture(channel),
  getRenderer: () => renderer,
  onTexturesUpdated: (cb) => mainScene.materialSurface.onTexturesUpdated(cb),
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

// On-demand render triggers: a bake/uniform re-render (new baked pixels in the same texture objects) or
// a material-object swap changes what's on screen with no loop to pick it up, so render on each.
mainScene.materialSurface.onTexturesUpdated(requestRender);
mainScene.materialSurface.onRebuilt(requestRender);

resize();
requestRender(); // initial frame

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
      if (resize()) renderNow();
    },
  });
  installBakeDevHandles({ mainScene, exporter });
}
}
