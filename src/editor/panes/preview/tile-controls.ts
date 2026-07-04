import { Minus, Plus, RotateCcw, createElement as createLucideElement, type IconNode } from "lucide";

import { FloatingWidget } from "@/editor/panes/graph/floating-widget";

export interface TileControlsOptions {
  mount: HTMLElement;
  // Step the tile scale by `dir` increments (+1 / -1). Clamping/rounding is the handler's job.
  onStep: (dir: number) => void;
  // Reset the tile scale to its default (1×).
  onReset: () => void;
}

// Bottom-left, vertical floating cluster over the scene canvas: [+] / [reset] / [-] tile scale.
// Reuses the graph editor's FloatingWidget (identical look to the scene controls).
export class TileControls {
  private readonly widget: FloatingWidget;

  constructor(opts: TileControlsOptions) {
    this.widget = new FloatingWidget({
      mount: opts.mount,
      align: "bottom-left",
      orientation: "vertical",
    });

    this.addButton(Plus, "Increase tile scale", () => opts.onStep(1));
    this.addButton(RotateCcw, "Reset tile scale", () => opts.onReset());
    this.addButton(Minus, "Decrease tile scale", () => opts.onStep(-1));
  }

  // The widget root — re-appended to the scene host when the preview pane re-mounts (see boot.ts).
  get root(): HTMLElement {
    return this.widget.root;
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
