import * as THREE from "three";
import { WebGPURenderer, PMREMGenerator } from "three/webgpu";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { MainScene } from "./MainScene";
import { SceneControls } from "./scene-controls";
import { SCENE_LIGHT_PRESETS, matchScenePresetId } from "./scene-presets";
import { ModelControls } from "./model-controls";
import { MODEL_PRESETS } from "./model-presets";
import { TileControls } from "./tile-controls";
import { loadModelGeometry, parseModelGeometry } from "./model-loader";
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

// Initial camera framing, captured as a constant so "reset camera" restores exactly this.
const INITIAL_CAMERA_POS = new THREE.Vector3(0, 1.35, 7.2);
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 30);
camera.position.copy(INITIAL_CAMERA_POS);

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

// three's WebGPURenderer exposes its animation loop and node frame only as internals. On-demand rendering
// drives both: we stop the always-on internal loop (see renderer.init below) and tick the node frame per
// render so per-frame node updates (notably the shadow map) run. Typed once here instead of casting inline.
type RendererInternals = {
  _animation?: { stop(): void };
  _nodes?: { nodeFrame?: { update(): void } };
};
const rendererInternals = renderer as unknown as RendererInternals;

const controls = new OrbitControls(camera, sceneCanvas);
controls.enableDamping = true;

const mainScene = new MainScene();
// Orbit around the sphere's center (which sits over the centered plane) for a symmetric default view.
controls.target.copy(mainScene.focusPoint);
controls.update();

// "Lock lights" (default on) = turntable: dragging spins the material sample (sphere + ground) about Y while
// the lights/camera stay fixed, so the surfaces relight as it turns. Camera orbit is disabled in this mode
// (a custom left-drag drives the turntable instead). Unlocked = today's behavior: the sample + lights are
// world-fixed and the camera orbits the whole setup.
let lightsLocked = true;
controls.enableRotate = !lightsLocked; // locked → left-drag spins the turntable, not the camera

// Turntable state — a Y-axis (yaw) spin of the sample, driven by a custom left-drag while locked.
const TURNTABLE_SPEED = 0.01; // radians per pixel of horizontal drag
const _turnUp = new THREE.Vector3(0, 1, 0);
const _turnQuat = new THREE.Quaternion();
let turntableYaw = 0;
function applyTurntable(): void {
  mainScene.setTurntable(_turnQuat.setFromAxisAngle(_turnUp, turntableYaw));
}

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
// The single scene-render method — every path renders through this (directly, or debounced via
// requestRender). Advances the node frame, then renders.
function renderFrame(): void {
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
  // Advance three's node frame ourselves. The WebGPU render path only bumps `frameId` from the internal
  // setAnimationLoop (which we cancel — we render on demand) and from material bakes. ShadowNode dedups
  // its re-bake by `frameId`, so without this the ground shadow freezes on the last-baked silhouette until
  // the next material bake — it wouldn't follow a geometry swap or turntable spin. This mirrors exactly
  // what setAnimationLoop does each frame.
  rendererInternals._nodes?.nodeFrame?.update?.();
  renderer.render(mainScene.scene, camera);
}
// Shared coalescing scheduler (also used by the texture preview) — collapses a burst of change events into
// one rAF-timed render instead of a continuous loop.
const frameScheduler = createFrameScheduler(renderFrame);
function requestRender(): void {
  frameScheduler.request();
}

// Restore the default framing: initial camera position + orbit around the sphere. `controls.update()` fires
// a "change" (→ requestRender), and we request once more to be safe.
function resetCamera(): void {
  camera.position.copy(INITIAL_CAMERA_POS);
  controls.target.copy(mainScene.focusPoint);
  controls.update();
  turntableYaw = 0; // also restore the sample to its default orientation
  applyTurntable();
  requestRender();
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

// Turntable drag (locked mode only): left-drag spins the sample about Y. OrbitControls keeps wheel-zoom
// and right-drag-pan; its left-drag rotate is disabled while locked, so this owns the left drag.
let turnDrag: { pointerId: number; lastX: number } | null = null;
sceneCanvas.addEventListener("pointerdown", (event) => {
  if (!lightsLocked || event.button !== 0) return;
  turnDrag = { pointerId: event.pointerId, lastX: event.clientX };
  sceneCanvas.setPointerCapture(event.pointerId);
});
sceneCanvas.addEventListener("pointermove", (event) => {
  if (!turnDrag || event.pointerId !== turnDrag.pointerId) return;
  turntableYaw += (event.clientX - turnDrag.lastX) * TURNTABLE_SPEED;
  turnDrag.lastX = event.clientX;
  applyTurntable();
  requestRender();
});
function endTurnDrag(event: PointerEvent): void {
  if (!turnDrag || event.pointerId !== turnDrag.pointerId) return;
  sceneCanvas.releasePointerCapture(event.pointerId);
  turnDrag = null;
}
sceneCanvas.addEventListener("pointerup", endTurnDrag);
sceneCanvas.addEventListener("pointercancel", endTurnDrag);

const { materialEditor, paneElement, rebuildEditor, applyScenePreset, setTiling, getTiling } = setupTweakpane({
  app,
  graphHost,
  paneHost,
  renderer,
  mainScene,
  rendererConfig,
  resize,
  requestRender,
});

// Which preset (if any) the current lighting matches — so the overlay checks the right preset on load
// (the lights already reflect the loaded/default sceneState after setupTweakpane's applyDocumentSettings).
const dl = mainScene.directionalLight;
const initialPresetId = matchScenePresetId({
  toneMapping: renderer.toneMapping,
  exposure: renderer.toneMappingExposure,
  dirColor: `#${dl.color.getHexString()}`,
  dirIntensity: dl.intensity,
  dirPosition: { x: dl.position.x, y: dl.position.y, z: dl.position.z },
  ambColor: `#${mainScene.ambientLight.color.getHexString()}`,
  ambIntensity: mainScene.ambientLight.intensity,
  envIntensity: mainScene.scene.environmentIntensity,
});

// Bottom-right overlay cluster over the scene (reuses the graph editor's FloatingWidget): reset camera +
// lights lock + light presets. Handlers call straight into this closure — no React/event plumbing needed.
const sceneControls = new SceneControls({
  mount: sceneHost,
  onResetCamera: resetCamera,
  presets: SCENE_LIGHT_PRESETS,
  onApplyPreset: applyScenePreset,
  lightsLocked,
  onToggleLightsLock: (locked) => {
    lightsLocked = locked;
    controls.enableRotate = !locked; // locked → left-drag spins the turntable; unlocked → orbits the camera
    requestRender();
  },
  activePresetId: initialPresetId,
});

// Top-left overlay: pick the material sample geometry (built-in sphere or a lazy-loaded .obj model,
// plus custom .obj upload). `loadToken` guards against overlapping loads — if the user switches again
// mid-download, a stale result is dropped instead of clobbering the newer selection.
let loadToken = 0;
let lastValidModelId = "sphere";
const modelControls = new ModelControls({
  mount: sceneHost,
  onSelectPreset: (id) => {
    void selectModel(id);
  },
  onLoadCustom: (file) => {
    void loadCustomModel(file);
  },
});

// Bottom-left overlay: tile-scale stepper [+] / [reset] / [-]. Clamping/persistence live in setTiling.
const tileControls = new TileControls({
  mount: sceneHost,
  onStep: (dir) => setTiling(getTiling() + dir * 0.25),
  onReset: () => setTiling(1),
});

async function selectModel(id: string): Promise<void> {
  const preset = MODEL_PRESETS.find((p) => p.id === id);
  if (!preset) return;
  const token = ++loadToken; // also cancels any in-flight .obj load if the user switches away

  if (preset.build) {
    mainScene.setSampleGeometry(preset.build()); // three.js primitive — generated on demand, no fetch
    lastValidModelId = id;
    requestRender();
    return;
  }
  if (!preset.url) {
    mainScene.setSampleGeometry(null); // built-in sphere
    lastValidModelId = id;
    requestRender();
    return;
  }

  modelControls.setBusy(true);
  try {
    const geometry = await loadModelGeometry(preset.url);
    if (token !== loadToken) {
      geometry.dispose(); // a newer selection won the race — drop this one
      return;
    }
    mainScene.setSampleGeometry(geometry);
    lastValidModelId = id;
    requestRender();
  } catch (err) {
    console.warn(`[model] Failed to load ${preset.url}`, err);
    if (token === loadToken) modelControls.setSelected(lastValidModelId); // revert dropdown
  } finally {
    if (token === loadToken) modelControls.setBusy(false);
  }
}

async function loadCustomModel(file: File): Promise<void> {
  const token = ++loadToken;
  modelControls.setBusy(true);
  try {
    const geometry = await parseModelGeometry(await file.text());
    if (token !== loadToken) {
      geometry.dispose();
      return;
    }
    mainScene.setSampleGeometry(geometry);
    modelControls.showCustom(file.name);
    lastValidModelId = "sphere"; // no preset id for a custom upload; revert target is the sphere
    requestRender();
  } catch (err) {
    console.warn(`[model] Failed to load ${file.name}`, err);
    if (token === loadToken) modelControls.setSelected(lastValidModelId);
  } finally {
    if (token === loadToken) modelControls.setBusy(false);
  }
}

function attachPreviewHosts(nextSceneHost: HTMLDivElement, nextPaneHost: HTMLDivElement): void {
  sceneHost = nextSceneHost;
  paneHost = nextPaneHost;
  if (sceneCanvas.parentElement !== sceneHost) sceneHost.appendChild(sceneCanvas);
  if (sceneControls.root.parentElement !== sceneHost) sceneHost.appendChild(sceneControls.root);
  if (modelControls.root.parentElement !== sceneHost) sceneHost.appendChild(modelControls.root);
  if (tileControls.root.parentElement !== sceneHost) sceneHost.appendChild(tileControls.root);
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
rendererInternals._animation?.stop();
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
      if (resize()) renderFrame();
    },
  });
  installBakeDevHandles({ mainScene, exporter });
}
}
