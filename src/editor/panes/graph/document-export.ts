import type { GraphNode, MaterialGraphDocument } from "@/runtime";

export type DocumentExportOptions = {
  includeMetadata: boolean;
};

const DEFAULT_DOCUMENT_TITLE = "Untitled";

function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function withDefaultMetadata(doc: MaterialGraphDocument): MaterialGraphDocument {
  return {
    ...structuredClone(doc),
    metadata: {
      ...doc.metadata,
      title: doc.metadata?.title?.trim() || DEFAULT_DOCUMENT_TITLE,
    },
  };
}

function stripNodeMetadata(node: GraphNode): GraphNode {
  const next = structuredClone(node);
  delete next.position;
  if (next.subgraph) next.subgraph = stripDocumentMetadata(next.subgraph);
  return next;
}

export function stripDocumentMetadata(doc: MaterialGraphDocument): MaterialGraphDocument {
  return {
    edges: structuredClone(doc.edges),
    nodes: doc.nodes.map(stripNodeMetadata),
    version: doc.version,
  };
}

export function buildDocumentExport(
  doc: MaterialGraphDocument,
  options: DocumentExportOptions,
): MaterialGraphDocument {
  return options.includeMetadata ? withDefaultMetadata(doc) : stripDocumentMetadata(doc);
}

function serializeDocumentExport(
  doc: MaterialGraphDocument,
  options: DocumentExportOptions,
): string {
  return JSON.stringify(buildDocumentExport(doc, options), null, 2);
}

export function downloadDocumentExport(
  doc: MaterialGraphDocument,
  options: DocumentExportOptions,
): void {
  downloadJson("material.json", buildDocumentExport(doc, options));
}

export async function copyDocumentExportToClipboard(
  doc: MaterialGraphDocument,
  options: DocumentExportOptions,
): Promise<void> {
  await navigator.clipboard.writeText(serializeDocumentExport(doc, options));
}
