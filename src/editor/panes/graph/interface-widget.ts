import { type IconNode, Plus, X } from "lucide";
import type { TpButton, TpInput, TpNativeSelect } from "@tweakpad/ui";

import type { MaterialGraphController } from "./controller";
import { iconSlot } from "./floating-widget";
import type { PortDef, PortKind } from "@/runtime";

// Group-interface editor, mounted on the Group Input / Group Output boundary nodes (Phase 5). Lists the
// group's exposed sockets for that side with rename + delete, plus an add row (name + kind). Each edit
// calls the controller (which prunes dangling wires and recompiles) then `rerender` to rebuild the
// canvas — controller edits don't auto-rebuild the graph editor. `side` is "input" for the Group Input
// node (edits the group's inputs) and "output" for Group Output. Shader sockets aren't exposable through
// groups (our shader marker only flows Principled→Output — plan L1), so the kind picker omits it.
const KINDS: PortKind[] = ["float", "vector", "color"];

// Inputs start from a default value and then own what the user types (uncontrolled), so `value` reads the
// current text when a row commits.
function textInput(label: string, value: string): TpInput {
  const input = document.createElement("tp-input") as TpInput;
  input.className = "iface-name";
  input.label = label;
  input.defaultValue = value;
  return input;
}

function iconButton(icon: IconNode, label: string, onClick: () => void): TpButton {
  const button = document.createElement("tp-button") as TpButton;
  button.variant = "ghost";
  button.size = "icon-xs";
  button.title = label;
  button.textContent = label;
  button.appendChild(iconSlot(icon));
  button.addEventListener("click", onClick);
  return button;
}

export function mountInterfaceWidget(
  host: HTMLElement,
  controller: MaterialGraphController,
  side: "input" | "output",
  sockets: PortDef[],
  rerender: () => void,
): void {
  const root = document.createElement("div");
  root.className = "iface-widget";

  const title = document.createElement("div");
  title.className = "iface-title";
  title.textContent = side === "input" ? "Group Inputs" : "Group Outputs";
  root.appendChild(title);

  for (const s of sockets) {
    const row = document.createElement("div");
    row.className = "iface-row";

    const dot = document.createElement("span");
    dot.className = "iface-dot";
    dot.dataset.kind = s.kind;
    row.appendChild(dot);

    const current = s.label ?? s.key;
    const name = textInput(`${current} name`, current);
    // Rename on leaving the field (Enter leaves it too).
    name.addEventListener("focusout", () => {
      const next = name.value.trim();
      if (next && next !== current) {
        controller.renameGroupSocket(side, s.key, name.value);
        rerender();
      }
    });
    name.addEventListener("keydown", (e) => {
      if (e.key === "Enter") (e.target as HTMLElement).blur();
    });
    row.appendChild(name);

    row.appendChild(
      iconButton(X, `Remove ${current}`, () => {
        controller.removeGroupSocket(side, s.key);
        rerender();
      }),
    );
    root.appendChild(row);
  }

  // Add row
  const add = document.createElement("div");
  add.className = "iface-row iface-add";
  const newName = textInput("New socket name", "");
  newName.placeholder = "new socket";
  const kind = document.createElement("tp-native-select") as TpNativeSelect;
  kind.size = "sm";
  kind.label = "New socket kind";
  for (const k of KINDS) {
    const o = document.createElement("option");
    o.value = k;
    o.textContent = k;
    kind.appendChild(o);
  }
  kind.defaultValue = KINDS[0];
  const addSocket = () => {
    controller.addGroupSocket(side, newName.value || "socket", (kind.value || KINDS[0]) as PortKind);
    rerender();
  };
  newName.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addSocket();
  });
  add.append(newName, kind, iconButton(Plus, "Add socket", addSocket));
  root.appendChild(add);

  host.appendChild(root);
}
