import type { ContainerApi } from "@tweakpane/core";
import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";
import { Pane } from "tweakpane";
import { MainScene } from "@/editor/panes/preview/MainScene";
import { SCENE_LIGHT_PRESETS } from "@/editor/panes/preview/scene-presets";
import { EditorPanel } from "@/editor/panes/graph/editor-panel";
import { buildMaterialEditorConfig } from "@/editor/panes/graph/material-editor-config";
import { bakeService } from "@/runtime";
import { countGraphNodes } from "@/runtime";
import { BakeProgressWidget } from "./bake-progress-widget";

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
  requestRender: () => void;
}

export interface TweakpaneHandles {
  materialEditor: EditorPanel;
  paneElement: HTMLElement;
  rebuildEditor: () => void;
  // Apply a named lighting preset (see scene-presets.ts); mutates sceneState, syncs the Scene folder, and
  // applies + persists. Called from the scene overlay controls.
  applyScenePreset: (id: string) => void;
  // Clamp/round to [0.25, 8] step 0.25, apply to the meshes, persist, and re-render. Returns the applied
  // value. Called from the bottom-left tile-scale overlay (replaces the old Projection → tiling slider).
  setTiling: (value: number) => number;
  getTiling: () => number;
}

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
  requestRender,
}: TweakpaneDeps): TweakpaneHandles {
  const saveRendererConfig = (): void =>
    localStorage.setItem(RENDERER_CONFIG_KEY, JSON.stringify(rendererConfig));
  const savedSettings = mainScene.materialController.getUiSettings<Record<string, unknown>>();

  const pane = new Pane({ container: paneHost, title: "Material" });

  const materialState = mergeSetting(savedSettings, "materialState", {
    debugNormals: false,
  });
  const projectionState = mergeSetting(savedSettings, "projectionState", {
    tiling: 1,
    triplanar: false,
    worldPerTile: 1.2,
    sharpness: 8,
    parallax: 0,
  });
  // Re-bake shadows whenever the surface material rebuilds (family/backend swap or re-bake). Surface PBR
  // overrides used to be re-applied here too; they're now owned by the material graph's node sliders.
  mainScene.materialSurface.onRebuilt(() => {
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
        sceneState,
        rendererConfig,
      },
      { history: "skip" },
    );
  }

  function applyDocumentSettings(): void {
    mainScene.materialSurface.setNormalDebug(materialState.debugNormals);
    mainScene.setDemoTiling(projectionState.tiling);
    mainScene.materialSurface.setTriplanar(projectionState.triplanar);
    mainScene.materialSurface.setScale(projectionState.worldPerTile);
    mainScene.materialSurface.setSharpness(projectionState.sharpness);
    mainScene.materialSurface.setParallaxScale(projectionState.parallax);
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

  function setTiling(value: number): number {
    // Integer tiling only — a fractional factor can't close a wrap seam on round geometry (see
    // MainScene.setDemoTiling). Clamp to [1, 8].
    const v = Math.min(8, Math.max(1, Math.round(value)));
    projectionState.tiling = v;
    mainScene.setDemoTiling(v);
    saveDocumentSettings();
    requestRender();
    return v;
  }

  function getTiling(): number {
    return projectionState.tiling;
  }

  function applyScenePreset(id: string): void {
    const preset = SCENE_LIGHT_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    // Merge into the same sceneState the Scene folder is bound to (fresh dirPosition to avoid aliasing),
    // then reuse the normal paths so panel, scene, and persistence all stay in sync.
    Object.assign(sceneState, preset.values, { dirPosition: { ...preset.values.dirPosition } });
    pane.refresh(); // re-read bindings so the Scene sliders reflect the preset
    applyDocumentSettings(); // push to lights / renderer / env (also resizes → requestRender)
    mainScene.requestShadowBake(); // dir position/softness changed
    saveDocumentSettings();
    requestRender();
  }

  function buildMaterialControls(container: ContainerApi): void {
    const folder = container.addFolder({ title: "Graph", expanded: false });
    folder
      .addBinding(materialState, "debugNormals", { label: "debug normals" })
      .on("change", (event) => mainScene.materialSurface.setNormalDebug(event.value));

    const projection = container.addFolder({ title: "Projection", expanded: false });
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
  buildSceneControls(pane);
  buildRenderControls(pane);
  pane.on("change", () => {
    saveDocumentSettings();
    requestRender();
  });
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

  return { materialEditor, paneElement: pane.element, rebuildEditor, applyScenePreset, setTiling, getTiling };
}
