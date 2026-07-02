import type { MaterialGraphDocument } from "@/runtime";

export const MATERIAL_DOCUMENT_LOAD_EVENT = "material-designer:load-document";
export const MATERIAL_GRAPH_REBUILD_EVENT = "material-designer:graph-rebuild";

export type MaterialDocumentLoadEvent = CustomEvent<{
  document: MaterialGraphDocument;
  filename?: string;
}>;

export function dispatchMaterialDocumentLoad(document: MaterialGraphDocument, filename?: string): void {
  window.dispatchEvent(
    new CustomEvent(MATERIAL_DOCUMENT_LOAD_EVENT, {
      detail: { document, filename },
    }),
  );
}
