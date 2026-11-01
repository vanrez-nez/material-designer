import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";
import type { TpButton, TpInput, TpSelect, TpSlider, TpSwitch, TpTabs } from "@tweakpad/ui";
import { parseColor, serializeColor, type TpColorPicker } from "@tweakpad/ui/widgets";
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

export interface ControlsDeps {
  graphHost: HTMLDivElement;
  renderer: WebGPURenderer;
  mainScene: MainScene;
  rendererConfig: RendererConfig;
  resize: () => void;
  requestRender: () => void;
}

export interface ControlsHandles {
  materialEditor: EditorPanel;
  // The Controls panel (tabs of inline fields), placed into the Controls dialog each time it opens.
  controlsElement: HTMLElement;
  rebuildEditor: (options?: { fitView?: boolean }) => void;
  // Debug-normals visualization toggle. Lives outside the panel (a button in the viewport toolbar), so
  // it's driven through these handles.
  getDebugNormals: () => boolean;
  setDebugNormals: (on: boolean) => void;
  // Apply a named lighting preset (see scene-presets.ts); mutates sceneState, syncs the Scene tab, and
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

export function setupControls({
  graphHost,
  renderer,
  mainScene,
  rendererConfig,
  resize,
  requestRender,
}: ControlsDeps): ControlsHandles {
  const saveRendererConfig = (): void =>
    localStorage.setItem(RENDERER_CONFIG_KEY, JSON.stringify(rendererConfig));
  const savedSettings = mainScene.materialController.getUiSettings<Record<string, unknown>>();

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
    refreshControls(); // the Scene fields show the preset
    applyDocumentSettings(); // push to lights / renderer / env (also resizes → requestRender)
    mainScene.requestShadowBake(); // dir position/softness changed
    saveDocumentSettings();
    requestRender();
  }

  // debug-normals lives outside the panel (a viewport-toolbar button). Own its state + persistence here so
  // load (applyDocumentSettings) and the button stay in sync.
  function getDebugNormals(): boolean {
    return materialState.debugNormals;
  }
  function setDebugNormals(on: boolean): void {
    materialState.debugNormals = on;
    mainScene.materialSurface.setNormalDebug(on);
    saveDocumentSettings();
    requestRender();
  }

  // --- the Controls panel ---------------------------------------------------------------------------
  // Each field owns its value: it proposes an edit, which is accepted by writing it back, applied and
  // persisted. A preset rewrites the state and the fields re-read it (refreshControls).
  const refreshers: Array<() => void> = [];
  const refreshControls = (): void => refreshers.forEach((refresh) => refresh());
  const changed = (): void => {
    saveDocumentSettings();
    requestRender();
  };

  function slider(
    label: string,
    range: { min: number; max: number; step: number },
    read: () => number,
    apply: (value: number) => void,
  ): TpSlider {
    const control = document.createElement("tp-slider") as TpSlider;
    control.variant = "inline";
    control.editableValue = true;
    control.label = label;
    control.minimum = range.min;
    control.maximum = range.max;
    control.step = range.step;
    control.value = read();
    control.onValueChange = (event) => {
      const value = Array.isArray(event.detail.value) ? event.detail.value[0] : event.detail.value;
      if (value === undefined) return;
      control.value = value;
      apply(value);
      changed();
    };
    refreshers.push(() => (control.value = read()));
    return control;
  }

  function toggle(label: string, read: () => boolean, apply: (on: boolean) => void): TpSwitch {
    const control = document.createElement("tp-switch") as TpSwitch;
    control.variant = "inline";
    control.textContent = label;
    control.checked = read();
    control.onCheckedChange = (event) => {
      control.checked = event.detail.value;
      apply(event.detail.value);
      changed();
    };
    refreshers.push(() => (control.checked = read()));
    return control;
  }

  function choice(
    label: string,
    options: Record<string, number>,
    read: () => number,
    apply: (value: number) => void,
  ): TpSelect {
    const control = document.createElement("tp-select") as TpSelect;
    control.variant = "inline";
    control.label = label;
    for (const [text, value] of Object.entries(options)) {
      const option = document.createElement("option");
      option.value = String(value);
      option.textContent = text;
      control.appendChild(option);
    }
    control.value = String(read());
    control.onValueChange = (event) => {
      const value = Number(event.detail.value);
      control.value = String(value);
      apply(value);
      changed();
    };
    refreshers.push(() => (control.value = String(read())));
    return control;
  }

  // A color opens the picker from an inline row; lights take opaque `#rrggbb`.
  function color(label: string, read: () => string, apply: (hex: string) => void): TpColorPicker {
    const control = document.createElement("tp-color-picker") as TpColorPicker;
    control.picker = "popup";
    control.alpha = false;
    control.value = read();
    const trigger = document.createElement("tp-color-input");
    trigger.slot = "trigger";
    trigger.setAttribute("variant", "inline");
    trigger.setAttribute("label", label);
    control.appendChild(trigger);
    control.onValueChange = (event) => {
      const parsed = parseColor(event.detail.value);
      if (!parsed) return;
      const hex = serializeColor({ ...parsed, alpha: 1 }, "hex");
      control.value = hex;
      apply(hex);
      changed();
    };
    refreshers.push(() => (control.value = read()));
    return control;
  }

  // One inline number row per component; each typed value or step applies the whole vector.
  function vector(label: string, read: () => THREE.Vector3Like, apply: (value: THREE.Vector3Like) => void): HTMLElement[] {
    return (["x", "y", "z"] as const).map((axis) => {
      const control = document.createElement("tp-input") as TpInput;
      control.variant = "inline";
      control.type = "number";
      control.step = "0.1";
      control.label = `${label} ${axis.toUpperCase()}`;
      control.value = String(read()[axis]);
      control.onValueChange = (event) => {
        control.value = String(event.detail.value ?? "");
      };
      control.addEventListener("change", () => {
        const value = Number(control.value);
        if (!Number.isFinite(value)) {
          control.value = String(read()[axis]);
          return;
        }
        apply({ ...read(), [axis]: value });
        changed();
      });
      refreshers.push(() => (control.value = String(read()[axis])));
      return control;
    });
  }

  function panel(value: string, controls: HTMLElement[]): HTMLElement {
    const element = document.createElement("div");
    element.slot = "panel";
    element.setAttribute("value", value);
    element.className = "controls-panel__page";
    element.append(...controls);
    return element;
  }

  const projectionControls = [
    toggle("triplanar", () => projectionState.triplanar, (on) => {
      projectionState.triplanar = on;
      mainScene.materialSurface.setTriplanar(on);
    }),
    slider("world / tile", { min: 0.2, max: 6, step: 0.05 }, () => projectionState.worldPerTile, (v) => {
      projectionState.worldPerTile = v;
      mainScene.materialSurface.setScale(v);
    }),
    slider("sharpness", { min: 1, max: 24, step: 0.5 }, () => projectionState.sharpness, (v) => {
      projectionState.sharpness = v;
      mainScene.materialSurface.setSharpness(v);
    }),
    slider("parallax", { min: 0, max: 0.12, step: 0.005 }, () => projectionState.parallax, (v) => {
      projectionState.parallax = v;
      mainScene.materialSurface.setParallaxScale(v);
    }),
  ];

  const sceneControls = [
    choice("tone", TONE_MAPPING_MODES, () => sceneState.toneMapping, (mode) => {
      sceneState.toneMapping = mode as THREE.ToneMapping;
      setToneMapping(sceneState.toneMapping);
    }),
    slider("exposure", { min: 0, max: 3, step: 0.01 }, () => sceneState.exposure, (v) => {
      sceneState.exposure = v;
      renderer.toneMappingExposure = v;
    }),
    slider("key", { min: 0, max: 10, step: 0.1 }, () => sceneState.dirIntensity, (v) => {
      sceneState.dirIntensity = v;
      mainScene.directionalLight.intensity = v;
    }),
    color("key color", () => sceneState.dirColor, (hex) => {
      sceneState.dirColor = hex;
      mainScene.directionalLight.color.set(hex);
    }),
    ...vector("key position", () => sceneState.dirPosition, (position) => {
      Object.assign(sceneState.dirPosition, { x: position.x, y: position.y, z: position.z });
      mainScene.directionalLight.position.set(position.x, position.y, position.z);
      mainScene.requestShadowBake();
    }),
    slider("shadow soft", { min: 0, max: 25, step: 0.5 }, () => sceneState.shadowSoftness, (v) => {
      sceneState.shadowSoftness = v;
      mainScene.directionalLight.shadow.radius = v;
      mainScene.requestShadowBake();
    }),
    slider("shadow dark", { min: 0, max: 1, step: 0.01 }, () => sceneState.shadowDarkness, (v) => {
      sceneState.shadowDarkness = v;
      mainScene.directionalLight.shadow.intensity = v;
    }),
    slider("ambient", { min: 0, max: 3, step: 0.05 }, () => sceneState.ambIntensity, (v) => {
      sceneState.ambIntensity = v;
      mainScene.ambientLight.intensity = v;
    }),
    color("ambient color", () => sceneState.ambColor, (hex) => {
      sceneState.ambColor = hex;
      mainScene.ambientLight.color.set(hex);
    }),
    slider("IBL", { min: 0, max: 3, step: 0.05 }, () => sceneState.envIntensity, (v) => {
      sceneState.envIntensity = v;
      mainScene.scene.environmentIntensity = v;
    }),
  ];

  // MSAA and samples take effect when the renderer is created, so they apply on reload.
  const applyButton = document.createElement("tp-button") as TpButton;
  applyButton.className = "controls-panel__action";
  applyButton.variant = "outline";
  applyButton.textContent = "Apply (reload)";
  applyButton.addEventListener("click", () => {
    saveRendererConfig();
    location.reload();
  });
  const renderControls = [
    slider("pixel ratio", { min: 0.5, max: 2, step: 0.05 }, () => rendererConfig.pixelRatio, (v) => {
      rendererConfig.pixelRatio = v;
      renderer.setPixelRatio(v);
      resize();
      saveRendererConfig();
    }),
    toggle("transparent bg", () => rendererConfig.transparentBg, (on) => {
      rendererConfig.transparentBg = on;
      applyTransparentBg(on);
      saveRendererConfig();
    }),
    toggle("MSAA", () => rendererConfig.antialias, (on) => {
      rendererConfig.antialias = on;
      saveRendererConfig();
    }),
    choice("samples", { "2x": 2, "4x": 4, "8x": 8 }, () => rendererConfig.samples, (samples) => {
      rendererConfig.samples = samples;
      saveRendererConfig();
    }),
    applyButton,
  ];

  const tabs = document.createElement("tp-tabs") as TpTabs;
  tabs.className = "controls-panel";
  tabs.setAttribute("label", "Controls");
  tabs.setAttribute("variant", "underline");
  tabs.setAttribute("default-value", "projection");
  // Rows of inline fields, like the node bodies: the panel and its popups use compact density and the flat
  // appearance.
  tabs.setAttribute("density", "compact");
  tabs.setAttribute("appearance", "flat");
  for (const [value, title] of [
    ["projection", "Projection"],
    ["scene", "Scene"],
    ["render", "Render"],
  ]) {
    const tab = document.createElement("button");
    tab.slot = "tab";
    tab.value = value;
    tab.textContent = title;
    tabs.appendChild(tab);
  }
  tabs.append(
    panel("projection", projectionControls),
    panel("scene", sceneControls),
    panel("render", renderControls),
  );
  applyDocumentSettings();

  const materialEditor = new EditorPanel({ host: graphHost });
  const bakeWidget = new BakeProgressWidget({
    mount: materialEditor.overlayHost,
    subscribe: (cb) => bakeService.onBakeReport(cb),
  });
  const rebuildEditor = (options?: { fitView?: boolean }): void => {
    materialEditor.open(buildMaterialEditorConfig(mainScene.materialController, rebuildEditor), options);
    bakeWidget.setActive(
      "material",
      () => countGraphNodes(mainScene.materialController.document),
      () => mainScene.materialSurface.regenerate(),
    );
  };
  rebuildEditor();

  return {
    materialEditor,
    controlsElement: tabs,
    rebuildEditor,
    getDebugNormals,
    setDebugNormals,
    applyScenePreset,
    setTiling,
    getTiling,
  };
}
