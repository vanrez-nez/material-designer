import type { StateCreator } from "zustand";

import type { WorkspaceStore } from "@/store/app";

export type WorkspacePaneId = "graph" | "scene" | "texture-preview";
export type WorkspaceLayoutDirection = "horizontal" | "vertical";
export type WorkspaceLayoutPreset = "graph-left" | "graph-right" | "graph-top" | "graph-bottom";
export type WorkspacePaneVisibility = Record<WorkspacePaneId, boolean>;

export type WorkspaceLayoutNode =
  | {
      id: string;
      type: "pane";
      paneId: WorkspacePaneId;
    }
  | {
      children: WorkspaceLayoutNode[];
      direction: WorkspaceLayoutDirection;
      id: string;
      sizes: number[];
      type: "split";
    };

export type WorkspaceLayoutSlice = {
  layoutPreset: WorkspaceLayoutPreset;
  layoutTree: WorkspaceLayoutNode;
  maximizedPaneId: WorkspacePaneId | null;
  resetWorkspaceLayout: () => void;
  restoreWorkspaceLayout: () => void;
  setLayoutPreset: (preset: WorkspaceLayoutPreset) => void;
  setMaximizedPane: (paneId: WorkspacePaneId | null) => void;
  setPaneVisible: (paneId: WorkspacePaneId, visible: boolean) => void;
  updateLayoutSplitSizes: (splitId: string, sizes: number[]) => void;
  visiblePanes: WorkspacePaneVisibility;
};

export const DEFAULT_VISIBLE_PANES: WorkspacePaneVisibility = {
  graph: true,
  scene: true,
  "texture-preview": true,
};

export function createLayoutTree(preset: WorkspaceLayoutPreset): WorkspaceLayoutNode {
  const graph: WorkspaceLayoutNode = { id: "pane-graph", paneId: "graph", type: "pane" };
  const scene: WorkspaceLayoutNode = { id: "pane-scene", paneId: "scene", type: "pane" };
  const texturePreview: WorkspaceLayoutNode = {
    id: "pane-texture-preview",
    paneId: "texture-preview",
    type: "pane",
  };
  const horizontal = preset === "graph-left" || preset === "graph-right";
  const graphFirst = preset === "graph-left" || preset === "graph-top";
  const previewStack: WorkspaceLayoutNode = {
    children: [scene, texturePreview],
    direction: horizontal ? "vertical" : "horizontal",
    id: "split-scene-preview",
    sizes: [60, 40],
    type: "split",
  };

  return {
    children: graphFirst ? [graph, previewStack] : [previewStack, graph],
    direction: horizontal ? "horizontal" : "vertical",
    id: "root",
    sizes: graphFirst ? [62, 38] : [38, 62],
    type: "split",
  };
}

function updateSplitSizes(
  node: WorkspaceLayoutNode,
  splitId: string,
  sizes: number[],
): WorkspaceLayoutNode {
  if (node.type === "pane") return node;
  if (node.id === splitId) return { ...node, sizes: [...sizes] };

  return {
    ...node,
    children: node.children.map((child) => updateSplitSizes(child, splitId, sizes)),
  };
}

export function createWorkspaceLayoutSlice(): StateCreator<
  WorkspaceStore,
  [],
  [],
  WorkspaceLayoutSlice
> {
  return (set) => ({
    layoutPreset: "graph-left",
    layoutTree: createLayoutTree("graph-left"),
    maximizedPaneId: null,
    resetWorkspaceLayout: () =>
      set({
        layoutPreset: "graph-left",
        layoutTree: createLayoutTree("graph-left"),
        maximizedPaneId: null,
        visiblePanes: DEFAULT_VISIBLE_PANES,
      }),
    restoreWorkspaceLayout: () => set({ maximizedPaneId: null }),
    setLayoutPreset: (preset) =>
      set({
        layoutPreset: preset,
        layoutTree: createLayoutTree(preset),
        maximizedPaneId: null,
      }),
    setMaximizedPane: (paneId) => set({ maximizedPaneId: paneId }),
    setPaneVisible: (paneId, visible) =>
      set((state) => {
        if (!visible) {
          const visibleCount = Object.values(state.visiblePanes).filter(Boolean).length;
          if (visibleCount <= 1 && state.visiblePanes[paneId]) return state;
        }

        const visiblePanes = {
          ...state.visiblePanes,
          [paneId]: visible,
        };

        return {
          maximizedPaneId:
            !visible && state.maximizedPaneId === paneId ? null : state.maximizedPaneId,
          visiblePanes,
        };
      }),
    updateLayoutSplitSizes: (splitId, sizes) =>
      set((state) => ({
        layoutTree: updateSplitSizes(state.layoutTree, splitId, sizes),
      })),
    visiblePanes: DEFAULT_VISIBLE_PANES,
  });
}
