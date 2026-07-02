import type { MaterialGraphDocument } from "@/runtime";

export const MATERIAL_DOCUMENT_LOAD_EVENT = "material-designer:load-document";
export const MATERIAL_GRAPH_REBUILD_EVENT = "material-designer:graph-rebuild";
export const MATERIAL_GRAPH_PANE_MOUNT_EVENT = "material-designer:graph-pane-mount";
export const MATERIAL_PREVIEW_PANE_MOUNT_EVENT = "material-designer:preview-pane-mount";
export const GRAPH_AUTO_LAYOUT_EVENT = "material-designer:graph-auto-layout";

export type GraphLayoutArrangement = "down" | "right" | "up" | "left";

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
  paneHost: HTMLDivElement;
  sceneHost: HTMLDivElement;
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

export function dispatchMaterialGraphPaneMount(graphHost: HTMLDivElement): void {
  window.dispatchEvent(
    new CustomEvent(MATERIAL_GRAPH_PANE_MOUNT_EVENT, {
      detail: { graphHost },
    }),
  );
}

export function dispatchMaterialPreviewPaneMount(
  sceneHost: HTMLDivElement,
  paneHost: HTMLDivElement,
): void {
  window.dispatchEvent(
    new CustomEvent(MATERIAL_PREVIEW_PANE_MOUNT_EVENT, {
      detail: { paneHost, sceneHost },
    }),
  );
}
