import { Axis3d, SlidersHorizontal } from "lucide";
import type { TpToggle } from "@tweakpad/ui";

import { FloatingWidget } from "@/editor/panes/graph/floating-widget";

export interface ViewportControlsOptions {
  mount: HTMLElement;
  // Open the controls dialog (settings button).
  onOpenControls: () => void;
  // Initial debug-normals state, so the toggle button reflects the loaded value.
  debugNormals: boolean;
  // Reports the flipped debug-normals state back out.
  onToggleDebugNormals: (on: boolean) => void;
}

// Top-right, horizontal floating bar over the scene canvas: [settings ⚙] [debug-normals].
// Reuses the graph editor's FloatingWidget (identical look to the other scene overlays).
export class ViewportControls {
  private readonly widget: FloatingWidget;
  private readonly debugToggle: TpToggle;

  constructor(opts: ViewportControlsOptions) {
    this.widget = new FloatingWidget({
      mount: opts.mount,
      align: "top-right",
      orientation: "horizontal",
    });

    this.widget.addButton(SlidersHorizontal, "Controls", opts.onOpenControls);

    // Debug-normals toggle — pressed when on. Flips its own state and reports out.
    let on = opts.debugNormals;
    this.debugToggle = this.widget.addToggle(Axis3d, "Debug normals", () => {
      on = !on;
      this.debugToggle.pressed = on;
      opts.onToggleDebugNormals(on);
    });
    this.debugToggle.pressed = on;
  }

  // The widget root — re-appended to the scene host when the preview pane re-mounts (see boot.ts).
  get root(): HTMLElement {
    return this.widget.root;
  }

  // Keep the debug-normals button visual in sync when the state is changed elsewhere.
  setDebugNormals(on: boolean): void {
    this.debugToggle.pressed = on;
  }

  dispose(): void {
    this.widget.dispose();
  }
}
