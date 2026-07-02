import { create } from "zustand";
import type { StateCreator } from "zustand";
import { persist } from "zustand/middleware";
import type { PersistStorage, StorageValue } from "zustand/middleware";

import type { GraphChange, MaterialGraphDocument } from "@/runtime";
import { createDefaultDocument } from "@/scene/material/presets";

export type HistorySnapshot = Record<string, unknown>;

export type HistoryParticipant<TStore> = {
  capture: (state: TStore) => unknown;
  id: string;
  restore: (snapshot: unknown, currentState: TStore) => Partial<TStore>;
};

export type HistoryTransaction = {
  scope: string;
  snapshot: HistorySnapshot;
};

export type HistoryUpdateOptions = {
  history?: "checkpoint" | "skip";
};

export type MaterialGraphEvent = {
  change: GraphChange;
  revision: number;
};

export type MaterialGraphPatch = {
  document?: MaterialGraphDocument;
  groupPath?: string[];
  soloNode?: string | null;
};

export type HistorySlice = {
  activeHistoryTransaction: HistoryTransaction | null;
  beginHistoryTransaction: (scope?: string) => void;
  cancelHistoryTransaction: (scope?: string) => void;
  commitHistoryTransaction: (scope?: string) => void;
  createHistoryCheckpoint: (state: WorkspaceStore) => Pick<
    HistorySlice,
    "activeHistoryTransaction" | "historyFuture" | "historyPast"
  >;
  historyFuture: HistorySnapshot[];
  historyPast: HistorySnapshot[];
  isHistoryTransactionActive: (scope?: string) => boolean;
  redoHistory: () => void;
  undoHistory: () => void;
};

export type MaterialGraphSlice = {
  applyMaterialGraphPatch: (
    patch: MaterialGraphPatch,
    change: GraphChange,
    options?: HistoryUpdateOptions,
  ) => void;
  materialDocument: MaterialGraphDocument;
  materialGraphEvent: MaterialGraphEvent | null;
  materialGraphRevision: number;
  materialGroupPath: string[];
  materialSoloNode: string | null;
};

export type WorkspaceStore = HistorySlice & MaterialGraphSlice;

type PersistedWorkspaceState = Pick<
  WorkspaceStore,
  "materialDocument" | "materialGraphRevision" | "materialGroupPath" | "materialSoloNode"
>;

const DEFAULT_HISTORY_TRANSACTION_SCOPE = "global";
const MAX_HISTORY_OPERATIONS = 50;
const WORKSPACE_STORAGE_KEY = "material-designer-workspace-session";
const MATERIAL_GRAPH_STORAGE_KEY = "material-designer:material-graph-document:v1";
const LEGACY_MATERIAL_GRAPH_STORAGE_KEY = "material-graph-document:v1";
const DOC_VERSION = 2;

let isStorageHistoryTransactionActive = false;

function cloneDocument(doc: MaterialGraphDocument): MaterialGraphDocument {
  return structuredClone(doc);
}

function pushHistorySnapshot(
  history: HistorySnapshot[],
  snapshot: HistorySnapshot,
): HistorySnapshot[] {
  return [...history, snapshot].slice(-MAX_HISTORY_OPERATIONS);
}

function unshiftHistorySnapshot(
  history: HistorySnapshot[],
  snapshot: HistorySnapshot,
): HistorySnapshot[] {
  return [snapshot, ...history].slice(0, MAX_HISTORY_OPERATIONS);
}

function beginStorageHistoryTransaction() {
  isStorageHistoryTransactionActive = true;
}

function endStorageHistoryTransaction() {
  isStorageHistoryTransactionActive = false;
}

function createTransactionAwareSessionStorage<T>(): PersistStorage<T> {
  return {
    getItem: (name) => {
      const value = sessionStorage.getItem(name);

      return value ? (JSON.parse(value) as StorageValue<T>) : null;
    },
    removeItem: (name) => sessionStorage.removeItem(name),
    setItem: (name, value) => {
      if (isStorageHistoryTransactionActive) return;

      try {
        sessionStorage.setItem(name, JSON.stringify(value));
      } catch (error) {
        if (error instanceof DOMException && error.name === "QuotaExceededError") {
          sessionStorage.removeItem(name);
          return;
        }

        throw error;
      }
    },
  };
}

function captureHistorySnapshot(
  participants: Array<HistoryParticipant<WorkspaceStore>>,
  state: WorkspaceStore,
): HistorySnapshot {
  return Object.fromEntries(
    participants.map((participant) => [participant.id, participant.capture(state)]),
  );
}

function restoreHistorySnapshot(
  participants: Array<HistoryParticipant<WorkspaceStore>>,
  snapshot: HistorySnapshot,
  currentState: WorkspaceStore,
): Partial<WorkspaceStore> {
  return participants.reduce<Partial<WorkspaceStore>>((restorePatch, participant) => {
    if (!(participant.id in snapshot)) return restorePatch;

    return {
      ...restorePatch,
      ...participant.restore(snapshot[participant.id], currentState),
    };
  }, {});
}

function areHistorySnapshotsEqual(firstSnapshot: HistorySnapshot, secondSnapshot: HistorySnapshot) {
  return JSON.stringify(firstSnapshot) === JSON.stringify(secondSnapshot);
}

function readLegacyMaterialDocument(): MaterialGraphDocument | null {
  try {
    const raw =
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

function createHistorySlice(
  participants: Array<HistoryParticipant<WorkspaceStore>>,
): StateCreator<WorkspaceStore, [], [], HistorySlice> {
  return (set, get) => ({
    activeHistoryTransaction: null,
    beginHistoryTransaction: (scope = DEFAULT_HISTORY_TRANSACTION_SCOPE) =>
      set((state) => {
        if (state.activeHistoryTransaction) return state;

        beginStorageHistoryTransaction();

        return {
          activeHistoryTransaction: {
            scope,
            snapshot: captureHistorySnapshot(participants, state),
          },
        };
      }),
    cancelHistoryTransaction: (scope) =>
      set((state) => {
        if (
          scope &&
          state.activeHistoryTransaction &&
          state.activeHistoryTransaction.scope !== scope
        ) {
          return state;
        }

        endStorageHistoryTransaction();

        return { activeHistoryTransaction: null };
      }),
    commitHistoryTransaction: (scope) =>
      set((state) => {
        const transaction = state.activeHistoryTransaction;

        if (scope && transaction && transaction.scope !== scope) return state;

        endStorageHistoryTransaction();

        if (!transaction) return state;

        const currentSnapshot = captureHistorySnapshot(participants, state);

        if (areHistorySnapshotsEqual(transaction.snapshot, currentSnapshot)) {
          return { activeHistoryTransaction: null };
        }

        return {
          activeHistoryTransaction: null,
          historyFuture: [],
          historyPast: pushHistorySnapshot(state.historyPast, transaction.snapshot),
        };
      }),
    createHistoryCheckpoint: (state) => {
      endStorageHistoryTransaction();

      return {
        activeHistoryTransaction: null,
        historyFuture: [],
        historyPast: pushHistorySnapshot(
          state.historyPast,
          state.activeHistoryTransaction?.snapshot ?? captureHistorySnapshot(participants, state),
        ),
      };
    },
    historyFuture: [],
    historyPast: [],
    isHistoryTransactionActive: (scope) => {
      const transaction = get().activeHistoryTransaction;

      if (!transaction) return false;

      return scope ? transaction.scope === scope : true;
    },
    redoHistory: () =>
      set((state) => {
        endStorageHistoryTransaction();

        const next = state.historyFuture[0];
        if (!next) return state;

        return {
          ...restoreHistorySnapshot(participants, next, state),
          activeHistoryTransaction: null,
          historyFuture: state.historyFuture.slice(1),
          historyPast: pushHistorySnapshot(
            state.historyPast,
            captureHistorySnapshot(participants, state),
          ),
        };
      }),
    undoHistory: () =>
      set((state) => {
        endStorageHistoryTransaction();

        const previous = state.historyPast[state.historyPast.length - 1];
        if (!previous) return state;

        return {
          ...restoreHistorySnapshot(participants, previous, state),
          activeHistoryTransaction: null,
          historyFuture: unshiftHistorySnapshot(
            state.historyFuture,
            captureHistorySnapshot(participants, state),
          ),
          historyPast: state.historyPast.slice(0, -1),
        };
      }),
  });
}

function getHistoryPatch(state: WorkspaceStore, options?: HistoryUpdateOptions) {
  if (options?.history === "skip" || state.isHistoryTransactionActive()) return {};

  return state.createHistoryCheckpoint(state);
}

type MaterialGraphHistorySnapshot = {
  document: MaterialGraphDocument;
  groupPath: string[];
  soloNode: string | null;
};

const materialGraphHistoryParticipant: HistoryParticipant<WorkspaceStore> = {
  capture: (state): MaterialGraphHistorySnapshot => ({
    document: cloneDocument(state.materialDocument),
    groupPath: [...state.materialGroupPath],
    soloNode: state.materialSoloNode,
  }),
  id: "materialGraph",
  restore: (snapshot, currentState) => {
    const graphSnapshot = snapshot as MaterialGraphHistorySnapshot;
    const revision = currentState.materialGraphRevision + 1;

    return {
      materialDocument: cloneDocument(graphSnapshot.document),
      materialGraphEvent: {
        change: { kind: "structural" },
        revision,
      },
      materialGraphRevision: revision,
      materialGroupPath: [...graphSnapshot.groupPath],
      materialSoloNode: graphSnapshot.soloNode,
    };
  },
};

function createMaterialGraphSlice(): StateCreator<WorkspaceStore, [], [], MaterialGraphSlice> {
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
    materialDocument: readLegacyMaterialDocument() ?? createDefaultDocument(),
    materialGraphEvent: null,
    materialGraphRevision: 0,
    materialGroupPath: [],
    materialSoloNode: null,
  });
}

const historyParticipants: Array<HistoryParticipant<WorkspaceStore>> = [
  materialGraphHistoryParticipant,
];

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (...storeApi) => ({
      ...createHistorySlice(historyParticipants)(...storeApi),
      ...createMaterialGraphSlice()(...storeApi),
    }),
    {
      name: WORKSPACE_STORAGE_KEY,
      partialize: (state): PersistedWorkspaceState => ({
        materialDocument: state.materialDocument,
        materialGraphRevision: state.materialGraphRevision,
        materialGroupPath: state.materialGroupPath,
        materialSoloNode: state.materialSoloNode,
      }),
      storage: createTransactionAwareSessionStorage<PersistedWorkspaceState>(),
      version: 1,
    },
  ),
);
