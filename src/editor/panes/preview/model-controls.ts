import { Upload } from "lucide";
import type { TpButton, TpNativeSelect } from "@tweakpad/ui";

import { FloatingWidget } from "@/editor/panes/graph/floating-widget";
import { MODEL_PRESETS } from "./model-presets";

const CUSTOM_OPTION_VALUE = "__custom__";

export interface ModelControlsOptions {
  mount: HTMLElement;
  // A predefined model was picked from the dropdown (a MODEL_PRESETS id, e.g. "sphere", "suzanne").
  onSelectPreset: (id: string) => void;
  // The user chose a local .obj file via the load button.
  onLoadCustom: (file: File) => void;
}

// Top-left, horizontal floating cluster over the scene canvas: [load .obj] — separator — [model ▾].
// Reuses the graph editor's FloatingWidget (same look as the zoom / scene controls).
export class ModelControls {
  private readonly widget: FloatingWidget;
  private readonly select: TpNativeSelect;
  private readonly loadButton: TpButton;
  private readonly fileInput: HTMLInputElement;
  private customOption: HTMLOptionElement | null = null;

  constructor(opts: ModelControlsOptions) {
    this.widget = new FloatingWidget({
      mount: opts.mount,
      align: "top-left",
      orientation: "horizontal",
    });

    // Hidden file input driving the load button.
    this.fileInput = document.createElement("input");
    this.fileInput.type = "file";
    this.fileInput.accept = ".obj,model/obj";
    this.fileInput.hidden = true;
    this.fileInput.addEventListener("change", () => {
      const file = this.fileInput.files?.[0];
      this.fileInput.value = ""; // reset so re-selecting the same file fires change again
      if (file) opts.onLoadCustom(file);
    });
    this.widget.root.appendChild(this.fileInput);

    this.loadButton = this.widget.addButton(Upload, "Load custom .obj model", () => this.fileInput.click());

    this.widget.addSeparator();

    // Predefined model dropdown: a TweakPad native select, which mirrors its <option> children into the
    // browser's own picker.
    this.select = document.createElement("tp-native-select") as TpNativeSelect;
    this.select.size = "sm";
    this.select.label = "Preview model";
    this.select.title = "Preview model";
    for (const preset of MODEL_PRESETS) {
      const option = document.createElement("option");
      option.value = preset.id;
      option.textContent = preset.label;
      this.select.appendChild(option);
    }
    this.select.addEventListener("tp-value-change", (event) => {
      const value = String((event as CustomEvent<{ value: unknown }>).detail.value);
      if (value !== CUSTOM_OPTION_VALUE) opts.onSelectPreset(value);
    });
    this.widget.body.appendChild(this.select);
  }

  // The widget root — re-appended to the scene host when the preview pane re-mounts (see boot.ts).
  get root(): HTMLElement {
    return this.widget.root;
  }

  // Reflect the active preset in the dropdown without firing onSelectPreset.
  setSelected(id: string): void {
    this.select.value = id;
  }

  // Show a transient "Custom: <name>" entry (session-only) and select it.
  showCustom(name: string): void {
    if (!this.customOption) {
      this.customOption = document.createElement("option");
      this.customOption.value = CUSTOM_OPTION_VALUE;
      this.select.appendChild(this.customOption);
    }
    this.customOption.textContent = `Custom: ${name}`;
    this.select.value = CUSTOM_OPTION_VALUE;
  }

  // Busy state during a load: dim the widget and disable inputs.
  setBusy(busy: boolean): void {
    this.widget.setBusy(busy);
    this.select.disabled = busy;
    this.loadButton.disabled = busy;
  }

  dispose(): void {
    this.widget.dispose();
  }
}
