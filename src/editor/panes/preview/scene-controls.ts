import { Focus, Lock, createElement as createLucideElement, type IconNode } from "lucide";

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
  private readonly presetButtons = new Map<string, HTMLButtonElement>();

  constructor(opts: SceneControlsOptions) {
    this.widget = new FloatingWidget({
      mount: opts.mount,
      align: "bottom-right",
      orientation: "vertical",
    });

    this.addButton(Focus, "Reset camera", opts.onResetCamera);

    // Lock toggle — checked when locked. Flips its own state and reports out.
    let locked = opts.lightsLocked;
    const lockBtn = this.addButton(Lock, "Lock lights to view", () => {
      locked = !locked;
      this.setChecked(lockBtn, locked);
      lockBtn.title = locked ? "Lights locked to view" : "Lights unlocked";
      opts.onToggleLightsLock(locked);
    });
    this.setChecked(lockBtn, locked);
    lockBtn.title = locked ? "Lights locked to view" : "Lights unlocked";

    this.widget.addSeparator();

    for (const preset of opts.presets) {
      const btn = this.addButton(preset.icon, preset.label, () => {
        opts.onApplyPreset(preset.id);
        this.setActivePreset(preset.id);
      });
      this.presetButtons.set(preset.id, btn);
    }
    this.setActivePreset(opts.activePresetId);
  }

  // The widget root — re-appended to the scene host when the preview pane re-mounts (see boot.ts).
  get root(): HTMLElement {
    return this.widget.root;
  }

  // Mark exactly one preset button as active (checked), the rest inactive.
  setActivePreset(id: string | null): void {
    for (const [key, btn] of this.presetButtons) {
      this.setChecked(btn, key === id);
    }
  }

  private setChecked(btn: HTMLButtonElement, checked: boolean): void {
    btn.classList.toggle("fw__btn--active", checked);
    btn.setAttribute("aria-pressed", String(checked));
  }

  private addButton(icon: IconNode, label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = "fw__btn";
    btn.type = "button";
    btn.title = label;
    btn.setAttribute("aria-label", label);
    const svg = createLucideElement(icon, { "aria-hidden": "true", height: 14, stroke: "currentColor", width: 14 });
    svg.classList.add("lucide-icon");
    btn.appendChild(svg);
    btn.addEventListener("click", onClick);
    this.widget.body.appendChild(btn);
    return btn;
  }

  dispose(): void {
    this.widget.dispose();
  }
}
