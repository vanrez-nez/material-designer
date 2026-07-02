import type { StateCreator } from "zustand";

import type { GraphChange, MaterialGraphDocument } from "@/runtime";
import { createDefaultDocument } from "@/presets";
import type {
  HistoryParticipant,
  HistoryUpdateOptions,
  WorkspaceStore,
} from "@/store/app";

const MATERIAL_GRAPH_STORAGE_KEY = "material-designer:material-graph-document:v1";
const LEGACY_MATERIAL_GRAPH_STORAGE_KEY = "material-graph-document:v1";
const DOC_VERSION = 2;

export type MaterialGraphEvent = {
  change: GraphChange;
  revision: number;
};

export type MaterialGraphPatch = {
  document?: MaterialGraphDocument;
  groupPath?: string[];
  soloNode?: string | null;
};

export type MaterialGraphSlice = {
  applyMaterialGraphPatch: (
    patch: MaterialGraphPatch,
    change: GraphChange,
    options?: HistoryUpdateOptions,
  ) => void;
  setDocumentTitle: (title: string) => void;
  materialDocument: MaterialGraphDocument;
  materialGraphEvent: MaterialGraphEvent | null;
  materialGraphRevision: number;
  materialGroupPath: string[];
  materialSoloNode: string | null;
};

type MaterialGraphHistorySnapshot = {
  document: MaterialGraphDocument;
  groupPath: string[];
  soloNode: string | null;
};

function cloneDocument(doc: MaterialGraphDocument): MaterialGraphDocument {
  return structuredClone(doc);
}

function omitNodePositions(doc: MaterialGraphDocument): MaterialGraphDocument {
  return {
    ...doc,
    nodes: doc.nodes.map((node) => ({
      ...node,
      position: undefined,
      subgraph: node.subgraph ? omitNodePositions(node.subgraph) : undefined,
    })),
  };
}

function isLayoutOnlyChange(
  previous: MaterialGraphHistorySnapshot,
  next: MaterialGraphHistorySnapshot,
): boolean {
  return (
    previous.soloNode === next.soloNode &&
    JSON.stringify(previous.groupPath) === JSON.stringify(next.groupPath) &&
    JSON.stringify(omitNodePositions(previous.document)) ===
      JSON.stringify(omitNodePositions(next.document))
  );
}

function readLegacyMaterialDocument(): MaterialGraphDocument | null {
  try {
    const raw =
      localStorage.getItem(MATERIAL_GRAPH_STORAGE_KEY) ??
      localStorage.getItem(LEGACY_MATERIAL_GRAPH_STORAGE_KEY) ??
      sessionStorage.getItem(MATERIAL_GRAPH_STORAGE_KEY) ??
      sessionStorage.getItem(LEGACY_MATERIAL_GRAPH_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as MaterialGraphDocument;
    if (parsed.version !== DOC_VERSION || !Array.isArray(parsed.nodes)) return null;

    return parsed;
  } catch {
    return null;
  }
}

function getHistoryPatch(state: WorkspaceStore, options?: HistoryUpdateOptions) {
  if (options?.history === "skip" || state.isHistoryTransactionActive()) return {};

  return state.createHistoryCheckpoint(state);
}

export const materialGraphHistoryParticipant: HistoryParticipant<WorkspaceStore> = {
  capture: (state): MaterialGraphHistorySnapshot => ({
    document: cloneDocument(state.materialDocument),
    groupPath: [...state.materialGroupPath],
    soloNode: state.materialSoloNode,
  }),
  id: "materialGraph",
  restore: (snapshot, currentState) => {
    const graphSnapshot = snapshot as MaterialGraphHistorySnapshot;
    const revision = currentState.materialGraphRevision + 1;
    const currentSnapshot: MaterialGraphHistorySnapshot = {
      document: currentState.materialDocument,
      groupPath: currentState.materialGroupPath,
      soloNode: currentState.materialSoloNode,
    };

    return {
      materialDocument: cloneDocument(graphSnapshot.document),
      materialGraphEvent: {
        change: isLayoutOnlyChange(currentSnapshot, graphSnapshot)
          ? { kind: "layout" }
          : { kind: "structural" },
        revision,
      },
      materialGraphRevision: revision,
      materialGroupPath: [...graphSnapshot.groupPath],
      materialSoloNode: graphSnapshot.soloNode,
    };
  },
};

export function createMaterialGraphSlice(): StateCreator<
  WorkspaceStore,
  [],
  [],
  MaterialGraphSlice
> {
  return (set) => ({
    applyMaterialGraphPatch: (patch, change, options) =>
      set((state) => {
        const revision = state.materialGraphRevision + 1;

        return {
          ...getHistoryPatch(state, options),
          materialDocument: patch.document ?? state.materialDocument,
          materialGraphEvent: { change, revision },
          materialGraphRevision: revision,
          materialGroupPath: patch.groupPath ?? state.materialGroupPath,
          materialSoloNode:
            "soloNode" in patch ? patch.soloNode ?? null : state.materialSoloNode,
        };
      }),
    // Title is cosmetic (the compiler ignores metadata) — update the document in place WITHOUT emitting a
    // materialGraphEvent, so it persists but triggers no recompile/history. The controller re-reads the
    // store on its next edit, so nothing goes stale.
    setDocumentTitle: (title) =>
      set((state) => ({
        materialDocument: {
          ...state.materialDocument,
          metadata: { ...state.materialDocument.metadata, title },
        },
      })),
    materialDocument: readLegacyMaterialDocument() ?? createDefaultDocument(),
    materialGraphEvent: null,
    materialGraphRevision: 0,
    materialGroupPath: [],
    materialSoloNode: null,
  });
}
