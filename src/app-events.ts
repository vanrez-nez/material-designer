import type { MaterialGraphDocument } from "@/runtime";

export const MATERIAL_DOCUMENT_LOAD_EVENT = "material-designer:load-document";
export const MATERIAL_GRAPH_REBUILD_EVENT = "material-designer:graph-rebuild";
export const MATERIAL_GRAPH_PANE_MOUNT_EVENT = "material-designer:graph-pane-mount";
export const MATERIAL_PREVIEW_PANE_MOUNT_EVENT = "material-designer:preview-pane-mount";
export const MATERIAL_CONTROLS_DIALOG_MOUNT_EVENT = "material-designer:controls-dialog-mount";
export const MATERIAL_CONTROLS_OPEN_EVENT = "material-designer:controls-open";
export const GRAPH_AUTO_LAYOUT_EVENT = "material-designer:graph-auto-layout";
export const GRAPH_NAVIGATE_EVENT = "material-designer:graph-navigate";

export type GraphLayoutArrangement = "down" | "right" | "up" | "left";

// Exit the group-navigation trail to the given depth (0 = root). Bridges the React pane-title
// breadcrumb to the vanilla graph editor's group navigation.
export type GraphNavigateEvent = CustomEvent<{ depth: number }>;

export type MaterialDocumentLoadEvent = CustomEvent<{
  document: MaterialGraphDocument;
  filename?: string;
}>;

export type GraphAutoLayoutEvent = CustomEvent<{
  arrangement: GraphLayoutArrangement;
}>;

export type MaterialGraphPaneMountEvent = CustomEvent<{
  graphHost: HTMLDivElement;
}>;

export type MaterialPreviewPaneMountEvent = CustomEvent<{
  sceneHost: HTMLDivElement;
}>;

// The Tweakpane controls now live in a modal dialog rather than the always-on preview panel. The dialog
// fires this when its body mounts so the imperative pane element can be re-parented into it (mirrors the
// preview-pane mount handshake). Fires on every open, since the modal content re-mounts each time.
export type MaterialControlsDialogMountEvent = CustomEvent<{
  controlsHost: HTMLDivElement;
}>;

export function dispatchMaterialDocumentLoad(document: MaterialGraphDocument, filename?: string): void {
  window.dispatchEvent(
    new CustomEvent(MATERIAL_DOCUMENT_LOAD_EVENT, {
      detail: { document, filename },
    }),
  );
}

export function dispatchGraphAutoLayout(arrangement: GraphLayoutArrangement): void {
  window.dispatchEvent(
    new CustomEvent(GRAPH_AUTO_LAYOUT_EVENT, {
      detail: { arrangement },
    }),
  );
}

export function dispatchGraphNavigate(depth: number): void {
  window.dispatchEvent(new CustomEvent(GRAPH_NAVIGATE_EVENT, { detail: { depth } }));
}

export function dispatchMaterialGraphPaneMount(graphHost: HTMLDivElement): void {
  window.dispatchEvent(
    new CustomEvent(MATERIAL_GRAPH_PANE_MOUNT_EVENT, {
      detail: { graphHost },
    }),
  );
}

export function dispatchMaterialPreviewPaneMount(sceneHost: HTMLDivElement): void {
  window.dispatchEvent(
    new CustomEvent(MATERIAL_PREVIEW_PANE_MOUNT_EVENT, {
      detail: { sceneHost },
    }),
  );
}

export function dispatchControlsDialogMount(controlsHost: HTMLDivElement): void {
  window.dispatchEvent(
    new CustomEvent(MATERIAL_CONTROLS_DIALOG_MOUNT_EVENT, {
      detail: { controlsHost },
    }),
  );
}

// Fired by the viewport toolbar's settings button to open the React controls dialog.
export function dispatchOpenControls(): void {
  window.dispatchEvent(new CustomEvent(MATERIAL_CONTROLS_OPEN_EVENT));
}
