import { Axis3d, SlidersHorizontal, createElement as createLucideElement, type IconNode } from "lucide";

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
  private readonly debugBtn: HTMLButtonElement;

  constructor(opts: ViewportControlsOptions) {
    this.widget = new FloatingWidget({
      mount: opts.mount,
      align: "top-right",
      orientation: "horizontal",
    });

    this.addButton(SlidersHorizontal, "Controls", opts.onOpenControls);

    // Debug-normals toggle — checked when on. Flips its own state and reports out.
    let on = opts.debugNormals;
    this.debugBtn = this.addButton(Axis3d, "Debug normals", () => {
      on = !on;
      this.setChecked(this.debugBtn, on);
      opts.onToggleDebugNormals(on);
    });
    this.setChecked(this.debugBtn, on);
  }

  // The widget root — re-appended to the scene host when the preview pane re-mounts (see boot.ts).
  get root(): HTMLElement {
    return this.widget.root;
  }

  // Keep the debug-normals button visual in sync when the state is changed elsewhere.
  setDebugNormals(on: boolean): void {
    this.setChecked(this.debugBtn, on);
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
