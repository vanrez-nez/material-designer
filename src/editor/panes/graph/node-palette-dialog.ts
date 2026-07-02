import { Plus, X, createElement as createLucideElement, type IconNode } from "lucide";

import { FloatingWidget } from "./floating-widget";
import "./node-palette-dialog.css";

export interface PaletteItem {
  type: string;
  label: string;
  category?: string;
}

export interface AddNodeControlOptions {
  // Positioned container (the editor canvas host): hosts both the "+" widget and the dialog overlay.
  mount: HTMLElement;
  // Insert the picked node type (reuses the editor's addPaletteNode — viewport-centre placement).
  onPick: (type: string) => void;
}

function icon(node: IconNode, size = 14): SVGElement {
  const svg = createLucideElement(node, { "aria-hidden": "true", height: size, stroke: "currentColor", width: size });
  svg.classList.add("lucide-icon");
  return svg;
}

// Group items by category, preserving the order each category first appears; uncategorised → "other".
function groupByCategory(items: PaletteItem[]): Array<{ category: string; items: PaletteItem[] }> {
  const groups = new Map<string, PaletteItem[]>();
  for (const item of items) {
    const key = item.category ?? "other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }
  return [...groups.entries()].map(([category, catItems]) => ({ category, items: catItems }));
}

// Top-left "+" floating widget that opens a full, graph-pane-covering node palette dialog (columns per
// category, dialog-styled with just an X — no footer). Clicking an item inserts the node and closes.
export class AddNodeControl {
  private readonly widget: FloatingWidget;
  private readonly mount: HTMLElement;
  private readonly onPick: (type: string) => void;
  private palette: PaletteItem[] = [];
  private overlay: HTMLDivElement | null = null;
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      this.close();
    }
  };

  constructor(opts: AddNodeControlOptions) {
    this.mount = opts.mount;
    this.onPick = opts.onPick;

    this.widget = new FloatingWidget({
      mount: opts.mount,
      align: "top-left",
      orientation: "horizontal",
    });
    const btn = document.createElement("button");
    btn.className = "fw__btn";
    btn.type = "button";
    btn.title = "Add node";
    btn.setAttribute("aria-label", "Add node");
    btn.appendChild(icon(Plus));
    btn.addEventListener("click", () => this.open());
    this.widget.body.appendChild(btn);
    this.widget.setVisible(false);
  }

  // Re-fed on each editor rebuild; the "+" hides when the graph has no addable palette.
  setPalette(palette: PaletteItem[]): void {
    this.palette = palette;
    this.widget.setVisible(palette.length > 0);
    if (palette.length === 0) this.close();
  }

  private open(): void {
    if (this.overlay || this.palette.length === 0) return;

    const overlay = document.createElement("div");
    overlay.className = "node-palette-dialog";
    overlay.addEventListener("pointerdown", (event) => {
      if (event.target === overlay) this.close(); // backdrop click
    });

    const panel = document.createElement("div");
    panel.className = "node-palette-dialog__panel";

    const closeBtn = document.createElement("button");
    closeBtn.className = "node-palette-dialog__close";
    closeBtn.type = "button";
    closeBtn.title = "Close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.appendChild(icon(X, 16));
    closeBtn.addEventListener("click", () => this.close());

    const heading = document.createElement("div");
    heading.className = "node-palette-dialog__heading";
    heading.textContent = "Add Node";

    const columns = document.createElement("div");
    columns.className = "node-palette-dialog__columns";
    for (const group of groupByCategory(this.palette)) {
      const col = document.createElement("div");
      col.className = "node-palette-dialog__col";
      const head = document.createElement("div");
      head.className = "node-palette-dialog__col-head";
      head.dataset.category = group.category;
      head.textContent = group.category;
      col.appendChild(head);
      for (const item of group.items) {
        const itemBtn = document.createElement("button");
        itemBtn.className = "node-palette-dialog__item";
        itemBtn.type = "button";
        itemBtn.textContent = item.label;
        itemBtn.addEventListener("click", () => {
          this.close();
          this.onPick(item.type);
        });
        col.appendChild(itemBtn);
      }
      columns.appendChild(col);
    }

    panel.append(closeBtn, heading, columns);
    overlay.appendChild(panel);
    this.mount.appendChild(overlay);
    this.overlay = overlay;
    document.addEventListener("keydown", this.onKeyDown, { capture: true });
  }

  private close(): void {
    if (!this.overlay) return;
    this.overlay.remove();
    this.overlay = null;
    document.removeEventListener("keydown", this.onKeyDown, { capture: true });
  }

  dispose(): void {
    this.close();
    this.widget.dispose();
  }
}
