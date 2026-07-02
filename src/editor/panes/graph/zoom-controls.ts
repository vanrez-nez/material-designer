import { Scan, ZoomIn, ZoomOut, createElement as createLucideElement, type IconNode } from "lucide";

import { FloatingWidget } from "./floating-widget";

export interface ZoomControlsOptions {
  mount: HTMLElement;
  onZoomOut: () => void;
  onFit: () => void;
  onZoomIn: () => void;
}

// Top-right, horizontal floating widget hosting the graph zoom controls (out / fit / in).
export class ZoomControls {
  private readonly widget: FloatingWidget;

  constructor(opts: ZoomControlsOptions) {
    this.widget = new FloatingWidget({
      mount: opts.mount,
      align: "top-right",
      orientation: "horizontal",
    });

    this.addButton(ZoomOut, "Zoom out", opts.onZoomOut);
    this.addButton(Scan, "Fit to view", opts.onFit);
    this.addButton(ZoomIn, "Zoom in", opts.onZoomIn);
  }

  private addButton(icon: IconNode, label: string, onClick: () => void): void {
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
  }

  dispose(): void {
    this.widget.dispose();
  }
}
