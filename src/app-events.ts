import type { MaterialGraphDocument } from "@/runtime";

export const MATERIAL_DOCUMENT_LOAD_EVENT = "material-designer:load-document";
export const MATERIAL_GRAPH_REBUILD_EVENT = "material-designer:graph-rebuild";
export const GRAPH_AUTO_LAYOUT_EVENT = "material-designer:graph-auto-layout";

export type GraphLayoutArrangement = "down" | "right" | "up" | "left";

export type MaterialDocumentLoadEvent = CustomEvent<{
  document: MaterialGraphDocument;
  filename?: string;
}>;

export type GraphAutoLayoutEvent = CustomEvent<{
  arrangement: GraphLayoutArrangement;
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
