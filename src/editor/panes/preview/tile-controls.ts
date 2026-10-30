import { Minus, Plus, RotateCcw } from "lucide";

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

    this.widget.addButton(Plus, "Increase tile scale", () => opts.onStep(1));
    this.widget.addButton(RotateCcw, "Reset tile scale", () => opts.onReset());
    this.widget.addButton(Minus, "Decrease tile scale", () => opts.onStep(-1));
  }

  // The widget root — re-appended to the scene host when the preview pane re-mounts (see boot.ts).
  get root(): HTMLElement {
    return this.widget.root;
  }

  dispose(): void {
    this.widget.dispose();
  }
}
