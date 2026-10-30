import { Focus, Lock } from "lucide";
import type { TpToggle } from "@tweakpad/ui";

import { FloatingWidget } from "@/editor/panes/graph/floating-widget";
import type { ScenePreset } from "./scene-presets";

export interface SceneControlsOptions {
  mount: HTMLElement;
  onResetCamera: () => void;
  presets: ScenePreset[];
  onApplyPreset: (id: string) => void;
  // Lock lights to the view (default true). Reports flips back out so boot can toggle the mode.
  lightsLocked: boolean;
  onToggleLightsLock: (locked: boolean) => void;
  // Which preset the current lighting matches (checked on load); null = none.
  activePresetId: string | null;
}

// Bottom-right, vertical floating cluster over the scene canvas: [reset][lock] — separator — [presets].
// Reuses the graph editor's FloatingWidget (identical look to the zoom controls).
export class SceneControls {
  private readonly widget: FloatingWidget;
  private readonly presetToggles = new Map<string, TpToggle>();

  constructor(opts: SceneControlsOptions) {
    this.widget = new FloatingWidget({
      mount: opts.mount,
      align: "bottom-right",
      orientation: "vertical",
    });

    this.widget.addButton(Focus, "Reset camera", opts.onResetCamera);

    // Lock toggle — pressed when locked. Flips its own state and reports out.
    let locked = opts.lightsLocked;
    const lockToggle = this.widget.addToggle(Lock, "Lock lights to view", () => {
      locked = !locked;
      lockToggle.pressed = locked;
      lockToggle.title = locked ? "Lights locked to view" : "Lights unlocked";
      opts.onToggleLightsLock(locked);
    });
    lockToggle.pressed = locked;
    lockToggle.title = locked ? "Lights locked to view" : "Lights unlocked";

    this.widget.addSeparator();

    // Presets: pressing one (even the active one) applies it.
    for (const preset of opts.presets) {
      const toggle = this.widget.addToggle(preset.icon, preset.label, () => {
        opts.onApplyPreset(preset.id);
        this.setActivePreset(preset.id);
      });
      this.presetToggles.set(preset.id, toggle);
    }
    this.setActivePreset(opts.activePresetId);
  }

  // The widget root — re-appended to the scene host when the preview pane re-mounts (see boot.ts).
  get root(): HTMLElement {
    return this.widget.root;
  }

  // Mark exactly one preset as active (pressed), the rest inactive.
  setActivePreset(id: string | null): void {
    for (const [key, toggle] of this.presetToggles) {
      toggle.pressed = key === id;
    }
  }

  dispose(): void {
    this.widget.dispose();
  }
}
