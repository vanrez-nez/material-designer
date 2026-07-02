import { create } from "zustand";
import type { StateCreator } from "zustand";
import { persist } from "zustand/middleware";
import type { PersistStorage, StorageValue } from "zustand/middleware";

import type { MaterialGraphDocument } from "@/runtime";
import {
  createMaterialGraphSlice,
  materialGraphHistoryParticipant,
  type MaterialGraphSlice,
} from "@/store/modules/material-graph";
import {
  DEFAULT_VISIBLE_PANES,
  createLayoutTree,
  createWorkspaceLayoutSlice,
  type WorkspaceLayoutNode,
  type WorkspaceLayoutPreset,
  type WorkspaceLayoutSlice,
  type WorkspacePaneVisibility,
} from "@/store/modules/layout";

export type {
  MaterialGraphEvent,
  MaterialGraphPatch,
  MaterialGraphSlice,
} from "@/store/modules/material-graph";
export type {
  WorkspaceLayoutDirection,
  WorkspaceLayoutNode,
  WorkspaceLayoutPreset,
  WorkspaceLayoutSlice,
  WorkspacePaneVisibility,
  WorkspacePaneId,
} from "@/store/modules/layout";

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

export type WorkspaceStore = HistorySlice & MaterialGraphSlice & WorkspaceLayoutSlice;

type PersistedWorkspaceState = {
  layoutPreset: WorkspaceLayoutPreset;
  layoutTree: WorkspaceLayoutNode;
  materialDocument: MaterialGraphDocument;
  materialGraphRevision: number;
  materialGroupPath: string[];
  materialSoloNode: string | null;
  maximizedPaneId: WorkspaceStore["maximizedPaneId"];
  visiblePanes: WorkspacePaneVisibility;
};

const DEFAULT_HISTORY_TRANSACTION_SCOPE = "global";
const MAX_HISTORY_OPERATIONS = 50;
const WORKSPACE_STORAGE_KEY = "material-designer-workspace-session";

let isStorageHistoryTransactionActive = false;

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

function readBrowserStorageItem(name: string): string | null {
  try {
    const localValue = localStorage.getItem(name);
    if (localValue) return localValue;

    const sessionValue = sessionStorage.getItem(name);
    if (sessionValue) {
      localStorage.setItem(name, sessionValue);
      return sessionValue;
    }
  } catch {
    try {
      return sessionStorage.getItem(name);
    } catch {
      return null;
    }
  }

  return null;
}

function createTransactionAwareBrowserStorage<T>(): PersistStorage<T> {
  return {
    getItem: (name) => {
      const value = readBrowserStorageItem(name);

      return value ? (JSON.parse(value) as StorageValue<T>) : null;
    },
    removeItem: (name) => {
      localStorage.removeItem(name);
      sessionStorage.removeItem(name);
    },
    setItem: (name, value) => {
      if (isStorageHistoryTransactionActive) return;

      try {
        localStorage.setItem(name, JSON.stringify(value));
      } catch (error) {
        if (error instanceof DOMException && error.name === "QuotaExceededError") {
          localStorage.removeItem(name);
          return;
        }

        try {
          sessionStorage.setItem(name, JSON.stringify(value));
        } catch {
          throw error;
        }
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

const historyParticipants: Array<HistoryParticipant<WorkspaceStore>> = [
  materialGraphHistoryParticipant,
];

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (...storeApi) => ({
      ...createHistorySlice(historyParticipants)(...storeApi),
      ...createMaterialGraphSlice()(...storeApi),
      ...createWorkspaceLayoutSlice()(...storeApi),
    }),
    {
      name: WORKSPACE_STORAGE_KEY,
      partialize: (state): PersistedWorkspaceState => ({
        materialDocument: state.materialDocument,
        materialGraphRevision: state.materialGraphRevision,
        materialGroupPath: state.materialGroupPath,
        materialSoloNode: state.materialSoloNode,
        layoutPreset: state.layoutPreset,
        layoutTree: state.layoutTree,
        maximizedPaneId: state.maximizedPaneId,
        visiblePanes: state.visiblePanes,
      }),
      storage: createTransactionAwareBrowserStorage<PersistedWorkspaceState>(),
      migrate: (persisted): PersistedWorkspaceState => {
        const previousState = persisted as PersistedWorkspaceState;

        // The alignment presets were reduced to two: fold the retired presets onto the nearest
        // survivor (right→left, bottom→top) and regenerate the tree so the toolbar highlight and the
        // rendered layout stay consistent for existing sessions.
        const legacyPreset = (previousState.layoutPreset ?? "graph-left") as string;
        const layoutPreset: WorkspaceLayoutPreset =
          legacyPreset === "graph-top" || legacyPreset === "graph-bottom" ? "graph-top" : "graph-left";
        const presetChanged = legacyPreset !== layoutPreset;

        return {
          ...previousState,
          layoutPreset,
          layoutTree:
            presetChanged || !previousState.layoutTree
              ? createLayoutTree(layoutPreset)
              : previousState.layoutTree,
          maximizedPaneId: previousState.maximizedPaneId ?? null,
          visiblePanes: {
            ...DEFAULT_VISIBLE_PANES,
            ...(previousState.visiblePanes ?? {}),
          },
        };
      },
      version: 5,
    },
  ),
);
