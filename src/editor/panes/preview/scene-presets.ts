import * as THREE from "three";
import { CloudSun, Lightbulb, Sun, type IconNode } from "lucide";

// Lighting presets applied from the scene overlay controls. Each `values` object is a partial of the
// tweakpane `sceneState` (same field names/types), so applying a preset is a straight merge into that
// state followed by the module's normal apply/persist path — see `applyScenePreset` in debug/tweakpane.ts.
export interface ScenePresetValues {
  toneMapping: THREE.ToneMapping;
  exposure: number;
  dirColor: string;
  dirIntensity: number;
  dirPosition: { x: number; y: number; z: number };
  ambColor: string;
  ambIntensity: number;
  envIntensity: number;
  shadowSoftness: number;
  shadowDarkness: number;
}

export interface ScenePreset {
  id: string;
  label: string;
  icon: IconNode; // vanilla `lucide` icon node (matches the graph zoom controls)
  values: ScenePresetValues;
}

// The lighting fields that distinguish the presets — used to detect which preset (if any) the current
// scene matches, so the overlay can show the right button as checked (even after a persisted reload).
export type ScenePresetMatch = Pick<
  ScenePresetValues,
  "toneMapping" | "exposure" | "dirColor" | "dirIntensity" | "dirPosition" | "ambColor" | "ambIntensity" | "envIntensity"
>;

export function matchScenePresetId(live: ScenePresetMatch): string | null {
  const eq = (a: number, b: number): boolean => Math.abs(a - b) < 1e-3;
  const colorEq = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
  for (const p of SCENE_LIGHT_PRESETS) {
    const v = p.values;
    if (
      v.toneMapping === live.toneMapping &&
      eq(v.exposure, live.exposure) &&
      colorEq(v.dirColor, live.dirColor) &&
      eq(v.dirIntensity, live.dirIntensity) &&
      eq(v.dirPosition.x, live.dirPosition.x) &&
      eq(v.dirPosition.y, live.dirPosition.y) &&
      eq(v.dirPosition.z, live.dirPosition.z) &&
      colorEq(v.ambColor, live.ambColor) &&
      eq(v.ambIntensity, live.ambIntensity) &&
      eq(v.envIntensity, live.envIntensity)
    ) {
      return p.id;
    }
  }
  return null;
}

export const SCENE_LIGHT_PRESETS: ScenePreset[] = [
  {
    id: "studio",
    label: "Studio light",
    icon: Lightbulb,
    values: {
      toneMapping: THREE.ACESFilmicToneMapping,
      exposure: 1.0,
      dirColor: "#ffffff",
      dirIntensity: 3,
      dirPosition: { x: 3, y: 4, z: 5 },
      ambColor: "#ffffff",
      ambIntensity: 0.35,
      envIntensity: 0.1,
      shadowSoftness: 4,
      shadowDarkness: 1,
    },
  },
  {
    id: "warm",
    label: "Warm sunset",
    icon: Sun,
    values: {
      toneMapping: THREE.ACESFilmicToneMapping,
      exposure: 1.1,
      dirColor: "#ffd9a0",
      dirIntensity: 3.5,
      dirPosition: { x: 5, y: 1.8, z: 3 },
      ambColor: "#4a3320",
      ambIntensity: 0.25,
      envIntensity: 0.15,
      shadowSoftness: 6,
      shadowDarkness: 1,
    },
  },
  {
    id: "cool",
    label: "Cool overcast",
    icon: CloudSun,
    values: {
      toneMapping: THREE.ACESFilmicToneMapping,
      exposure: 1.0,
      dirColor: "#cfe0ff",
      dirIntensity: 1.6,
      dirPosition: { x: 2, y: 6, z: 3 },
      ambColor: "#2a3240",
      ambIntensity: 0.6,
      envIntensity: 0.35,
      shadowSoftness: 12,
      shadowDarkness: 0.6,
    },
  },
];
