import { parseColor, serializeColor } from "@tweakpad/ui/widgets";
import type { EditorGraphConfig, EditorNodeConfig, EditorPaletteItem, EditorPropertyConfig } from "./types";
import type { MaterialGraphController } from "./controller";
import { nodePorts, nodeParamDefs } from "@/runtime";
import { mountCurveWidget } from "./curve-widget";
import { mountInterfaceWidget } from "./interface-widget";
import {
  GROUP_INPUT_TYPE,
  GROUP_OUTPUT_TYPE,
  GROUP_TYPE,
  type CurveValue,
  type GraphNode,
  type ParamDef,
  type ParamType,
  type PortDef,
} from "@/runtime";

const OUTPUT_TYPE = "material-output";
// Nodes that can't be deleted from the canvas (terminal output + a subgraph's boundary markers).
const UNDELETABLE = new Set([OUTPUT_TYPE, GROUP_INPUT_TYPE, GROUP_OUTPUT_TYPE]);
// Boundary markers live only inside a subgraph — never offered in the add-node palette. `principled-bsdf`
// stays registered (so legacy in-memory docs validate) but is superseded by the polymorphic `shader-material`
// node, so it's hidden from the palette too.
const PALETTE_HIDDEN = new Set([OUTPUT_TYPE, GROUP_INPUT_TYPE, GROUP_OUTPUT_TYPE, "principled-bsdf"]);

// Registry-driven adapter: turns the controller's live MaterialGraphDocument into the generic editor
// config (material-graph-plan.md). Node ports and controls are generated from each node's MaterialNodeDef —
// no hand-written per-node builders. Param edits flow back into the controller (live uniform update or
// recompile), so the surface reacts immediately.

// The canvas control for each param type it renders as a property row. A vector shows one number row per
// component (see propertiesFor); curves are mounted as body content instead (see curveControls).
const PROPERTY_CONTROLS: Partial<Record<ParamType, EditorPropertyConfig["control"]>> = {
  bool: "switch",
  color: "color",
  float: "slider",
  int: "slider",
  select: "select",
};

const VECTOR_AXES = ["x", "y", "z"] as const;

// A vector component's property key, e.g. `location.x`; the node's data holds each component under it.
const componentKey = (key: string, axis: string): string => `${key}.${axis}`;

function propertiesFor(param: ParamDef): EditorPropertyConfig[] {
  if (param.type === "vec3") {
    return VECTOR_AXES.map((axis) => ({
      key: componentKey(param.key, axis),
      label: `${param.label} ${axis.toUpperCase()}`,
      control: "number",
    }));
  }
  const control = PROPERTY_CONTROLS[param.type];
  if (!control) return [];
  return [
    {
      key: param.key,
      label: param.label,
      control,
      min: param.min,
      max: param.max,
      step: param.step ?? (param.type === "int" ? 1 : undefined),
      options: param.options,
    },
  ];
}

// Applies a property edit from the canvas. A slider drag or a color pick proposes many values and then
// commits: the proposals write live in one history transaction, committed as one undo step. A select or
// switch proposes once and is a checkpoint of its own.
function applyParamEdit(
  controller: MaterialGraphController,
  nodeId: string,
  param: ParamDef,
  value: unknown,
  phase: "propose" | "commit",
  // For nodes whose ports or visible params follow a mode, re-renders the editor once the mode changed.
  // Deferred (queueMicrotask) so the canvas rebuild doesn't replace the node in the middle of its event.
  onModeChange?: () => void,
): void {
  const scope = `param:${nodeId}:${param.key}`;
  if (param.type === "select" || param.type === "bool") {
    if (phase === "propose") {
      controller.setParam(nodeId, param.key, value);
      if (onModeChange) queueMicrotask(onModeChange);
    }
    return;
  }
  if (phase === "commit") {
    if (controller.isHistoryTransactionActive(scope)) controller.commitHistoryTransaction(scope);
    // An int can decide which params a mode shows (e.g. Voronoi's relax), so a settled change re-renders.
    if (param.type === "int" && onModeChange) queueMicrotask(onModeChange);
    return;
  }
  // A non-finite number would serialise to invalid WGSL and invalidate the whole shader: use the default.
  // Colors are opaque `#rrggbb`, whatever notation or alpha the picker proposes.
  const next =
    param.type === "color"
      ? opaqueHex(value)
      : (param.type === "int" || param.type === "float") && !Number.isFinite(Number(value))
        ? param.default
        : value;
  if (next === null) return;
  if (!controller.isHistoryTransactionActive(scope)) controller.beginHistoryTransaction(scope);
  controller.setParam(nodeId, param.key, next, { history: "skip" });
}

function opaqueHex(value: unknown): string | null {
  const color = parseColor(String(value));
  return color ? serializeColor({ ...color, alpha: 1 }, "hex") : null;
}

// Curve params have no property control: their editor mounts below the property rows.
function curveControls(
  controller: MaterialGraphController,
  nodeId: string,
  params: ParamDef[],
  values: Record<string, unknown>,
): ((host: HTMLElement) => () => void) | undefined {
  if (params.length === 0) return undefined;
  return (host) => {
    for (const param of params) {
      mountCurveWidget(host, controller, nodeId, param.key, values[param.key] as CurveValue);
    }
    return () => host.replaceChildren();
  };
}

// Group Input / Group Output nodes get an interface editor (add/rename/remove exposed sockets) instead
// of param controls. Returns the mount fn, or undefined for non-boundary nodes (fall back to params).
function groupBoundaryControls(
  controller: MaterialGraphController,
  node: GraphNode,
  ports: { inputs: PortDef[]; outputs: PortDef[] },
  rerender: () => void,
): ((host: HTMLElement) => () => void) | undefined {
  if (node.type !== GROUP_INPUT_TYPE && node.type !== GROUP_OUTPUT_TYPE) return undefined;
  // The boundary mirrors the interface on its opposite face: Group Input's *outputs* are the group's
  // inputs; Group Output's *inputs* are the group's outputs.
  const side = node.type === GROUP_INPUT_TYPE ? "input" : "output";
  const sockets = side === "input" ? ports.outputs : ports.inputs;
  return (host) => {
    mountInterfaceWidget(host, controller, side, sockets, rerender);
    return () => {};
  };
}

// Build the editor config for a single graph node (ports, generated controls, toggle, delete).
function nodeToConfig(
  controller: MaterialGraphController,
  node: GraphNode,
  rerender: () => void,
): EditorNodeConfig {
  const registry = controller.getRegistry();
  const def = registry.get(node.type);
  // A node's effective ports: instance-specific (groups) or the static def. See registry.nodePorts.
  const ports = nodePorts(node, registry);
  // A node's effective (context-sensitive) params: only the controls that take effect in the current mode
  // (e.g. Tileable Noise hides `aspect` on cellular types). See registry.nodeParamDefs. Hidden params keep
  // their value in node.params; switching mode re-renders (below) and restores them.
  const paramDefs = nodeParamDefs(node, registry);
  // The values the controls show, defaults filled in.
  const values: Record<string, unknown> = {};
  for (const p of paramDefs) {
    let v = node.params[p.key] ?? p.default;
    // Never surface a non-finite numeric param (a value corrupted to NaN by a transient empty field) in the
    // control — fall back to the default so the editor neither shows nor re-commits NaN.
    if ((p.type === "int" || p.type === "float") && !Number.isFinite(Number(v))) v = p.default;
    // vec3 / curve are objects their editors mutate in place — deep-copy so edits don't alias node.params
    // before they're committed via setParam.
    values[p.key] =
      p.type === "vec3" ? { ...(v as object) } : p.type === "curve" ? structuredClone(v) : v;
  }
  const properties = paramDefs.flatMap(propertiesFor);
  // The canvas shows each property from the node's data: a vector's components sit under their own keys.
  const data: Record<string, unknown> = { ...values };
  for (const p of paramDefs) {
    if (p.type !== "vec3") continue;
    const vector = values[p.key] as Record<string, number>;
    for (const axis of VECTOR_AXES) data[componentKey(p.key, axis)] = vector[axis];
  }
  // A mode change (select/bool, or an int a mode reads) can add/remove ports (declare) and/or params
  // (paramsFor) → rerender.
  const onModeChange = def.declare || def.paramsFor ? rerender : undefined;

  // Solo/preview routes a node's FIRST output to the surface. Only previewable values qualify: a node with
  // no outputs (Material Output, Group Output) or a shader-closure first output (Principled/Emission) can't
  // be shown as colour, so it gets no solo button.
  const firstOut = ports.outputs[0];
  const canSolo = Boolean(firstOut) && firstOut.kind !== "shader";

  return {
    id: node.id,
    title: node.label ?? def.label,
    defaultTitle: def.label,
    onRename: (label) => controller.setNodeLabel(node.id, label),
    nodeClass: def.nodeClass,
    position: node.position,
    inputs: ports.inputs.map((p) => ({ key: p.key, label: p.label ?? p.key, kind: p.kind })),
    outputs: ports.outputs.map((p) => ({ key: p.key, label: p.label ?? p.key, kind: p.kind })),
    properties,
    values: data,
    onPropertyChange: (key, value, phase) => {
      const [paramKey, axis] = key.split(".");
      const param = paramDefs.find((p) => p.key === paramKey);
      if (!param) return;
      if (param.type === "vec3") {
        // A component edit replaces the vector, one checkpoint per typed value or step.
        const n = Number(value);
        if (phase !== "propose" || !axis || !Number.isFinite(n)) return;
        const vector = { ...(values[param.key] as Record<string, number>), [axis]: n };
        values[param.key] = vector;
        controller.setParam(node.id, param.key, vector);
        return;
      }
      applyParamEdit(controller, node.id, param, value, phase, onModeChange);
    },
    mountControls:
      groupBoundaryControls(controller, node, ports, rerender) ??
      curveControls(
        controller,
        node.id,
        paramDefs.filter((p) => p.type === "curve"),
        values,
      ),
    // Exclusive solo: reflect whether this node is the previewed one; toggling rebuilds the editor so the
    // previously-soloed node's button clears too.
    soloed: controller.soloNode === node.id,
    onSolo: canSolo
      ? () => {
          controller.toggleSolo(node.id);
          rerender();
        }
      : undefined,
    deletable: !UNDELETABLE.has(node.type),
    // Group nodes are enterable: double-click descends into the subgraph, then re-render the canvas.
    onEnter:
      node.type === GROUP_TYPE
        ? () => {
            if (controller.enterGroup(node.id)) rerender();
          }
        : undefined,
  };
}

// `rerender` re-opens the editor with a fresh config — used by group enter/exit navigation, which swaps
// the active (sub)document. Defaults to a no-op for callers that don't navigate.
export function buildMaterialEditorConfig(
  controller: MaterialGraphController,
  rerender: () => void = () => {},
): EditorGraphConfig {
  const registry = controller.getRegistry();
  const doc = controller.activeDocument;

  const nodes: EditorNodeConfig[] = doc.nodes.map((node) => nodeToConfig(controller, node, rerender));

  // Palette: registered nodes except the terminal output and the subgraph boundary markers.
  const palette: EditorPaletteItem[] = registry
    .all()
    .filter((def) => !PALETTE_HIDDEN.has(def.type))
    .map((def) => ({ type: def.type, label: def.label, category: def.nodeClass }));

  const connections = doc.edges.map((e) => ({
    from: e.fromNode,
    fromOutput: e.fromOutput,
    to: e.toNode,
    toInput: e.toInput,
  }));

  // Breadcrumb: always starts with the root "Material" crumb (it doubles as the editor title), then each
  // entered group; clicking a crumb pops back to that depth. Group crumbs show the display name (custom
  // label, else type name) rather than the raw id.
  const trail = controller.groupTrail();
  const breadcrumb = [
    { label: "Material", onClick: () => (controller.exitToDepth(0), rerender()) },
    ...trail.map((crumb, i) => ({
      label: crumb.label,
      onClick: () => (controller.exitToDepth(i + 1), rerender()),
    })),
  ];

  return {
    nodes,
    connections,
    palette,
    breadcrumb,
    onExit: trail.length > 0 ? () => (controller.exitGroup(), rerender()) : undefined,
    // Drawing a wire validates (port kinds) + applies via the controller; false vetoes it (snap back).
    onConnect: (c) =>
      controller.connect({ fromNode: c.from, fromOutput: c.fromOutput, toNode: c.to, toInput: c.toInput }),
    onDisconnect: (c) =>
      controller.disconnect({
        fromNode: c.from,
        fromOutput: c.fromOutput,
        toNode: c.to,
        toInput: c.toInput,
      }),
    onAddNode: (type, position) => {
      const id = controller.addNode(type, position);
      const node = controller.activeDocument.nodes.find((n) => n.id === id);
      return node ? nodeToConfig(controller, node, rerender) : null;
    },
    onDeleteNode: (id) => controller.removeNode(id),
    onNodePositionTransactionStart: () => controller.beginHistoryTransaction("node-position"),
    onNodePositionTransactionEnd: () => controller.commitHistoryTransaction("node-position"),
    onNodePositionsChange: (positions, options) => controller.setNodePositions(positions, options),
    editorViewState: controller.getEditorViewState(),
    onEditorViewStateChange: (state, options) => controller.setEditorViewState(state, options),
  };
}
