import * as EssentialsPlugin from "@tweakpane/plugin-essentials";
import type { ContainerApi } from "@tweakpane/core";
import * as THREE from "three";
import { WebGPURenderer, MeshPhysicalNodeMaterial } from "three/webgpu";
import { Pane } from "tweakpane";
import { MainScene } from "@/editor/panes/preview/MainScene";
import { StatsBladeApi, StatsPanePluginBundle } from "../tweak-pane/stats-blade";
import { EditorPanel } from "@/editor/panes/graph/editor-panel";
import { buildMaterialEditorConfig } from "@/editor/panes/graph/material-editor-config";
import { bakeService } from "@/runtime";
import { countGraphNodes } from "@/runtime";
import { BakeProgressWidget } from "./bake-progress-widget";
import { MATERIAL_PRESETS, makePreset, DEFAULT_PRESET } from "@/presets";
import type { PbrSocket } from "@/runtime";
import type { ExportApi } from "./export";

export interface RendererConfig {
  antialias: boolean;
  samples: number;
  pixelRatio: number;
  transparentBg: boolean;
}

const RENDERER_CONFIG_KEY = "rendererConfig";

export function loadRendererConfig(): RendererConfig {
  const defaults: RendererConfig = {
    antialias: true,
    samples: 4,
    pixelRatio: Math.min(window.devicePixelRatio, 2),
    transparentBg: false,
  };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(RENDERER_CONFIG_KEY) ?? "{}") };
  } catch {
    return defaults;
  }
}

export interface TweakpaneDeps {
  app: HTMLDivElement;
  graphHost: HTMLDivElement;
  paneHost: HTMLDivElement;
  renderer: WebGPURenderer;
  mainScene: MainScene;
  rendererConfig: RendererConfig;
  resize: () => void;
  exporter: ExportApi;
}

export interface TweakpaneHandles {
  stats: StatsBladeApi;
  materialEditor: EditorPanel;
  paneElement: HTMLElement;
  rebuildEditor: () => void;
}

type PreviewChannel = "basecolor" | "normal" | "ao" | "roughness";

const PREVIEW_SOCKET: Record<PreviewChannel, PbrSocket> = {
  basecolor: "baseColor",
  normal: "normal",
  ao: "ambientOcclusion",
  roughness: "roughness",
};

function mergeSetting<T extends Record<string, unknown>>(
  settings: Record<string, unknown>,
  key: string,
  defaults: T,
): T {
  const saved = settings[key];
  return {
    ...defaults,
    ...(saved && typeof saved === "object" ? (saved as Partial<T>) : {}),
  };
}

export function setupTweakpane({
  app,
  graphHost,
  paneHost,
  renderer,
  mainScene,
  rendererConfig,
  resize,
  exporter,
}: TweakpaneDeps): TweakpaneHandles {
  const saveRendererConfig = (): void =>
    localStorage.setItem(RENDERER_CONFIG_KEY, JSON.stringify(rendererConfig));
  const savedSettings = mainScene.materialController.getUiSettings<Record<string, unknown>>();

  const pane = new Pane({ container: paneHost, title: "Material" });
  pane.registerPlugin(EssentialsPlugin);
  pane.registerPlugin(StatsPanePluginBundle);

  const stats = pane.addBlade({ view: "stats" }) as StatsBladeApi;

  const materialState = mergeSetting(savedSettings, "materialState", {
    backend: "offline" as "live" | "offline",
    preset: DEFAULT_PRESET,
    debugNormals: false,
  });
  const projectionState = mergeSetting(savedSettings, "projectionState", {
    tiling: 1,
    triplanar: false,
    worldPerTile: 1.2,
    sharpness: 8,
    parallax: 0,
  });
  const surfaceMaterialState = mergeSetting(savedSettings, "surfaceMaterialState", {
    envMapIntensity: 1,
    flatShading: false,
    baseColorTint: "#ffffff",
    roughnessFactor: 1,
    metalnessFactor: 1,
    clearcoat: 0,
    clearcoatRoughness: 0.03,
    sheen: 0,
    sheenRoughness: 0.3,
    sheenColor: "#ffffff",
    transmission: 0,
    thickness: 0.5,
    ior: 1.5,
    iridescence: 0,
    iridescenceIOR: 1.3,
  });

  function applySurfaceMaterialState(): void {
    const m = mainScene.materialSurface.material as MeshPhysicalNodeMaterial;
    const s = surfaceMaterialState;
    m.envMapIntensity = s.envMapIntensity;
    m.flatShading = s.flatShading;
    m.clearcoat = s.clearcoat;
    m.clearcoatRoughness = s.clearcoatRoughness;
    m.sheen = s.sheen;
    m.sheenRoughness = s.sheenRoughness;
    m.sheenColor.set(s.sheenColor);
    m.transmission = s.transmission;
    m.thickness = s.thickness;
    m.ior = s.ior;
    m.iridescence = s.iridescence;
    m.iridescenceIOR = s.iridescenceIOR;
    m.needsUpdate = true;
  }

  let lastSurfaceMaterial: unknown = mainScene.materialSurface.material;
  mainScene.materialSurface.onRebuilt(() => {
    const m = mainScene.materialSurface.material;
    if (m !== lastSurfaceMaterial) {
      lastSurfaceMaterial = m;
      applySurfaceMaterialState();
    }
    mainScene.requestShadowBake();
  });

  const TONE_MAPPING_MODES: Record<string, THREE.ToneMapping> = {
    None: THREE.NoToneMapping,
    AgX: THREE.AgXToneMapping,
    "ACES Filmic": THREE.ACESFilmicToneMapping,
    Neutral: THREE.NeutralToneMapping,
    Reinhard: THREE.ReinhardToneMapping,
    Cineon: THREE.CineonToneMapping,
  };
  const sceneState = mergeSetting(savedSettings, "sceneState", {
    toneMapping: renderer.toneMapping as THREE.ToneMapping,
    exposure: renderer.toneMappingExposure,
    dirIntensity: mainScene.directionalLight.intensity,
    dirColor: `#${mainScene.directionalLight.color.getHexString()}`,
    dirPosition: { ...mainScene.directionalLight.position },
    ambIntensity: mainScene.ambientLight.intensity,
    ambColor: `#${mainScene.ambientLight.color.getHexString()}`,
    envIntensity: 0.1,
    shadowSoftness: mainScene.directionalLight.shadow.radius,
    shadowDarkness: mainScene.directionalLight.shadow.intensity,
  });

  function setToneMapping(mode: THREE.ToneMapping): void {
    renderer.toneMapping = mode;
    mainScene.scene.traverse((obj) => {
      const material = (obj as THREE.Mesh).material;
      if (!material) return;
      for (const m of Array.isArray(material) ? material : [material]) m.needsUpdate = true;
    });
  }

  function applyTransparentBg(on: boolean): void {
    mainScene.scene.background = on ? null : new THREE.Color(0x181818);
    renderer.setClearAlpha(on ? 0 : 1);
  }

  function saveDocumentSettings(): void {
    mainScene.materialController.setUiSettings(
      {
        materialState,
        projectionState,
        surfaceMaterialState,
        sceneState,
        rendererConfig,
      },
      { history: "skip" },
    );
  }

  function applyDocumentSettings(): void {
    mainScene.materialSurface.setBackend(materialState.backend);
    mainScene.materialSurface.setNormalDebug(materialState.debugNormals);
    mainScene.setDemoTiling(projectionState.tiling);
    mainScene.materialSurface.setTriplanar(projectionState.triplanar);
    mainScene.materialSurface.setScale(projectionState.worldPerTile);
    mainScene.materialSurface.setSharpness(projectionState.sharpness);
    mainScene.materialSurface.setParallaxScale(projectionState.parallax);
    applySurfaceMaterialState();
    mainScene.materialSurface.setColorTint(surfaceMaterialState.baseColorTint);
    mainScene.materialSurface.setRoughnessFactor(surfaceMaterialState.roughnessFactor);
    mainScene.materialSurface.setMetalnessFactor(surfaceMaterialState.metalnessFactor);
    setToneMapping(sceneState.toneMapping);
    renderer.toneMappingExposure = sceneState.exposure;
    mainScene.directionalLight.intensity = sceneState.dirIntensity;
    mainScene.directionalLight.color.set(sceneState.dirColor);
    mainScene.directionalLight.position.set(sceneState.dirPosition.x, sceneState.dirPosition.y, sceneState.dirPosition.z);
    mainScene.directionalLight.shadow.radius = sceneState.shadowSoftness;
    mainScene.directionalLight.shadow.intensity = sceneState.shadowDarkness;
    mainScene.ambientLight.intensity = sceneState.ambIntensity;
    mainScene.ambientLight.color.set(sceneState.ambColor);
    mainScene.scene.environmentIntensity = sceneState.envIntensity;
    renderer.setPixelRatio(rendererConfig.pixelRatio);
    applyTransparentBg(rendererConfig.transparentBg);
    resize();
  }

  function buildMaterialControls(container: ContainerApi): void {
    const folder = container.addFolder({ title: "Graph", expanded: true });
    folder
      .addBinding(materialState, "preset", {
        label: "preset",
        options: Object.fromEntries(MATERIAL_PRESETS.map((p) => [p.label, p.key])),
      })
      .on("change", (event) => {
        mainScene.materialController.loadDocument(makePreset(event.value));
        rebuildEditor();
      });
    folder
      .addBinding(materialState, "backend", { options: { Offline: "offline", Live: "live" } })
      .on("change", (event) => mainScene.materialSurface.setBackend(event.value));
    folder
      .addBinding(materialState, "debugNormals", { label: "debug normals" })
      .on("change", (event) => mainScene.materialSurface.setNormalDebug(event.value));
    folder.addButton({ title: "Refresh graph" }).on("click", () => rebuildEditor());

    const projection = container.addFolder({ title: "Projection", expanded: true });
    projection
      .addBinding(projectionState, "tiling", { min: 0.25, max: 8, step: 0.25 })
      .on("change", (event) => mainScene.setDemoTiling(event.value));
    projection
      .addBinding(projectionState, "triplanar", { label: "triplanar" })
      .on("change", (event) => mainScene.materialSurface.setTriplanar(event.value));
    projection
      .addBinding(projectionState, "worldPerTile", { label: "world / tile", min: 0.2, max: 6, step: 0.05 })
      .on("change", (event) => mainScene.materialSurface.setScale(event.value));
    projection
      .addBinding(projectionState, "sharpness", { min: 1, max: 24, step: 0.5 })
      .on("change", (event) => mainScene.materialSurface.setSharpness(event.value));
    projection
      .addBinding(projectionState, "parallax", { min: 0, max: 0.12, step: 0.005 })
      .on("change", (event) => mainScene.materialSurface.setParallaxScale(event.value));
  }

  function buildSurfaceControls(container: ContainerApi): void {
    const surface = container.addFolder({ title: "Surface (PBR)", expanded: false });
    const onSurface = (): void => applySurfaceMaterialState();
    surface
      .addBinding(surfaceMaterialState, "envMapIntensity", { label: "env intensity", min: 0, max: 3, step: 0.05 })
      .on("change", onSurface);
    surface.addBinding(surfaceMaterialState, "flatShading", { label: "flat shading" }).on("change", onSurface);
    surface
      .addBinding(surfaceMaterialState, "baseColorTint", { label: "color tint", view: "color" })
      .on("change", (e) => mainScene.materialSurface.setColorTint(e.value));
    surface
      .addBinding(surfaceMaterialState, "roughnessFactor", { label: "roughness x", min: 0, max: 2, step: 0.01 })
      .on("change", (e) => mainScene.materialSurface.setRoughnessFactor(e.value));
    surface
      .addBinding(surfaceMaterialState, "metalnessFactor", { label: "metalness x", min: 0, max: 1, step: 0.01 })
      .on("change", (e) => mainScene.materialSurface.setMetalnessFactor(e.value));

    const coat = surface.addFolder({ title: "Clearcoat", expanded: false });
    coat.addBinding(surfaceMaterialState, "clearcoat", { label: "weight", min: 0, max: 1, step: 0.01 }).on("change", onSurface);
    coat.addBinding(surfaceMaterialState, "clearcoatRoughness", { label: "roughness", min: 0, max: 1, step: 0.01 }).on("change", onSurface);

    const sheen = surface.addFolder({ title: "Sheen", expanded: false });
    sheen.addBinding(surfaceMaterialState, "sheen", { label: "weight", min: 0, max: 1, step: 0.01 }).on("change", onSurface);
    sheen.addBinding(surfaceMaterialState, "sheenRoughness", { label: "roughness", min: 0, max: 1, step: 0.01 }).on("change", onSurface);
    sheen.addBinding(surfaceMaterialState, "sheenColor", { label: "color", view: "color" }).on("change", onSurface);

    const trans = surface.addFolder({ title: "Transmission", expanded: false });
    trans.addBinding(surfaceMaterialState, "transmission", { label: "weight", min: 0, max: 1, step: 0.01 }).on("change", onSurface);
    trans.addBinding(surfaceMaterialState, "thickness", { min: 0, max: 5, step: 0.05 }).on("change", onSurface);
    trans.addBinding(surfaceMaterialState, "ior", { label: "IOR", min: 1, max: 2.5, step: 0.01 }).on("change", onSurface);

    const irid = surface.addFolder({ title: "Iridescence", expanded: false });
    irid.addBinding(surfaceMaterialState, "iridescence", { label: "weight", min: 0, max: 1, step: 0.01 }).on("change", onSurface);
    irid.addBinding(surfaceMaterialState, "iridescenceIOR", { label: "IOR", min: 1, max: 2.5, step: 0.01 }).on("change", onSurface);
  }

  function buildExportControls(container: ContainerApi): void {
    const folder = container.addFolder({ title: "Export PNG", expanded: false });
    for (const channel of ["basecolor", "normal", "ao", "roughness"] as const) {
      folder.addButton({ title: `Export ${channel}` }).on("click", () => {
        void exporter.downloadChannelPng(PREVIEW_SOCKET[channel], `material-${channel}.png`);
      });
    }

    if (import.meta.env.DEV) {
      const bakeFolder = container.addFolder({ title: "Bake to ./bake", expanded: false });
      for (const channel of ["basecolor", "normal", "ao", "roughness"] as const) {
        bakeFolder
          .addButton({ title: `Save ${channel}` })
          .on("click", () => void exporter.saveChannelToBake(PREVIEW_SOCKET[channel]));
      }
    }
  }

  function buildSceneControls(container: ContainerApi): void {
    const folder = container.addFolder({ title: "Scene", expanded: false });
    folder
      .addBinding(sceneState, "toneMapping", { label: "tone", options: TONE_MAPPING_MODES })
      .on("change", (e) => setToneMapping(e.value));
    folder
      .addBinding(sceneState, "exposure", { min: 0, max: 3, step: 0.01 })
      .on("change", (e) => (renderer.toneMappingExposure = e.value));
    folder
      .addBinding(sceneState, "dirIntensity", { label: "key", min: 0, max: 10, step: 0.1 })
      .on("change", (e) => (mainScene.directionalLight.intensity = e.value));
    folder
      .addBinding(sceneState, "dirColor", { label: "key color", view: "color" })
      .on("change", (e) => mainScene.directionalLight.color.set(e.value));
    folder
      .addBinding(sceneState, "dirPosition", { label: "key position" })
      .on("change", (e) => {
        mainScene.directionalLight.position.set(e.value.x, e.value.y, e.value.z);
        mainScene.requestShadowBake();
      });
    folder
      .addBinding(sceneState, "shadowSoftness", { label: "shadow soft", min: 0, max: 25, step: 0.5 })
      .on("change", (e) => {
        mainScene.directionalLight.shadow.radius = e.value;
        mainScene.requestShadowBake();
      });
    folder
      .addBinding(sceneState, "shadowDarkness", { label: "shadow dark", min: 0, max: 1, step: 0.01 })
      .on("change", (e) => (mainScene.directionalLight.shadow.intensity = e.value));
    folder
      .addBinding(sceneState, "ambIntensity", { label: "ambient", min: 0, max: 3, step: 0.05 })
      .on("change", (e) => (mainScene.ambientLight.intensity = e.value));
    folder
      .addBinding(sceneState, "ambColor", { label: "ambient color", view: "color" })
      .on("change", (e) => mainScene.ambientLight.color.set(e.value));
    folder
      .addBinding(sceneState, "envIntensity", { label: "IBL", min: 0, max: 3, step: 0.05 })
      .on("change", (e) => (mainScene.scene.environmentIntensity = e.value));
  }

  function buildRenderControls(container: ContainerApi): void {
    const folder = container.addFolder({ title: "Render", expanded: false });
    folder
      .addBinding(rendererConfig, "pixelRatio", { label: "pixel ratio", min: 0.5, max: 2, step: 0.05 })
      .on("change", (e) => {
        renderer.setPixelRatio(e.value);
        resize();
        saveRendererConfig();
      });
    folder
      .addBinding(rendererConfig, "transparentBg", { label: "transparent bg" })
      .on("change", (e) => {
        applyTransparentBg(e.value);
        saveRendererConfig();
      });
    folder.addBinding(rendererConfig, "antialias", { label: "MSAA" }).on("change", saveRendererConfig);
    folder
      .addBinding(rendererConfig, "samples", { options: { "2x": 2, "4x": 4, "8x": 8 } })
      .on("change", saveRendererConfig);
    folder.addButton({ title: "Apply (reload)" }).on("click", () => {
      saveRendererConfig();
      location.reload();
    });
  }

  buildMaterialControls(pane);
  buildSurfaceControls(pane);
  buildExportControls(pane);
  buildSceneControls(pane);
  buildRenderControls(pane);
  pane.on("change", () => saveDocumentSettings());
  applyDocumentSettings();

  const materialEditor = new EditorPanel({
    host: graphHost,
    appElement: app,
    embedded: true,
  });
  const bakeWidget = new BakeProgressWidget({
    mount: materialEditor.overlayHost,
    subscribe: (cb) => bakeService.onBakeReport(cb),
  });
  const rebuildEditor = (): void => {
    materialEditor.open(buildMaterialEditorConfig(mainScene.materialController, rebuildEditor));
    bakeWidget.setActive(
      "material",
      () => countGraphNodes(mainScene.materialController.document),
      () => mainScene.materialSurface.regenerate(),
    );
  };
  rebuildEditor();

  return { stats, materialEditor, paneElement: pane.element, rebuildEditor };
}
