import { Plus } from "lucide";
import type { TpButton, TpDialog } from "@tweakpad/ui";

import { FloatingWidget } from "./floating-widget";
import "./node-palette-dialog.css";

export interface PaletteItem {
  type: string;
  label: string;
  category?: string;
}

export interface AddNodeControlOptions {
  // Positioned container (the editor canvas host): hosts both the "+" widget and the dialog.
  mount: HTMLElement;
  // Insert the picked node type (reuses the editor's addPaletteNode — viewport-centre placement).
  onPick: (type: string) => void;
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

// Top-left "+" floating widget that opens the node palette: a TweakPad dialog scoped to the graph pane
// (container modality), with one column per category. Clicking an item inserts the node and closes.
export class AddNodeControl {
  private readonly widget: FloatingWidget;
  private readonly mount: HTMLElement;
  private readonly onPick: (type: string) => void;
  private palette: PaletteItem[] = [];
  private dialog: TpDialog | null = null;

  constructor(opts: AddNodeControlOptions) {
    this.mount = opts.mount;
    this.onPick = opts.onPick;

    this.widget = new FloatingWidget({
      mount: opts.mount,
      align: "top-left",
      orientation: "horizontal",
    });
    this.widget.addButton(Plus, "Add node", () => this.open());
    this.widget.setVisible(false);
  }

  // Re-fed on each editor rebuild; the "+" hides when the graph has no addable palette.
  setPalette(palette: PaletteItem[]): void {
    this.palette = palette;
    this.widget.setVisible(palette.length > 0);
    if (palette.length === 0) this.close();
  }

  private open(): void {
    if (this.dialog || this.palette.length === 0) return;

    const dialog = document.createElement("tp-dialog") as TpDialog;
    dialog.className = "node-palette-dialog";
    dialog.label = "Add Node";
    dialog.modality = "container";
    dialog.container = this.mount;

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
        const itemButton = document.createElement("tp-button") as TpButton;
        itemButton.variant = "ghost";
        itemButton.size = "sm";
        itemButton.textContent = item.label;
        itemButton.addEventListener("click", () => {
          this.close();
          this.onPick(item.type);
        });
        col.appendChild(itemButton);
      }
      columns.appendChild(col);
    }
    dialog.appendChild(columns);

    // Escape, an outside press and the close control all report a close; once it settles, drop the dialog.
    dialog.addEventListener("tp-open-change", (event) => {
      if (event.target === dialog && !(event as CustomEvent<{ value: boolean }>).detail.value) this.close();
    });

    this.mount.appendChild(dialog);
    this.dialog = dialog;
    dialog.open = true;
  }

  private close(): void {
    const dialog = this.dialog;
    if (!dialog) return;
    this.dialog = null;
    dialog.open = false;
    dialog.addEventListener("tp-open-change-complete", () => dialog.remove(), { once: true });
    // Fallback when no close transition runs.
    requestAnimationFrame(() => {
      if (!dialog.open) dialog.remove();
    });
  }

  dispose(): void {
    this.close();
    this.widget.dispose();
  }
}
