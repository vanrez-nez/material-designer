import { createContext, type ReactNode, useContext, useLayoutEffect, useMemo, useRef } from "react";
import { Maximize2, X } from "lucide-react";
import type { TpResizablePanelGroup } from "@tweakpad/ui";
import { Button, ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@tweakpad/ui/react";

import { useCompactLayout } from "@/lib/use-compact-layout";
import { cn } from "@/lib/utils";
import {
  useWorkspaceStore,
  type WorkspaceLayoutNode,
  type WorkspacePaneId,
} from "@/store/app";

type PaneRegistry = Record<WorkspacePaneId, ReactNode>;
type PaneToolbarRegistry = Partial<Record<WorkspacePaneId, ReactNode>>;
type PaneTitleRegistry = Partial<Record<WorkspacePaneId, ReactNode>>;

// The pane filling the workspace, if any: the maximized pane, or on a compact screen the one picked there.
const ShownPaneContext = createContext<{ compact: boolean; shownPaneId: WorkspacePaneId | null }>({
  compact: false,
  shownPaneId: null,
});

const paneTitle: Record<WorkspacePaneId, string> = {
  graph: "Graph",
  scene: "Scene",
  "texture-preview": "Textures",
};

export function WorkspaceLayout({
  panes,
  toolbars = {},
  titles = {},
}: {
  panes: PaneRegistry;
  toolbars?: PaneToolbarRegistry;
  titles?: PaneTitleRegistry;
}) {
  const layoutTree = useWorkspaceStore((state) => state.layoutTree);
  const maximizedPaneId = useWorkspaceStore((state) => state.maximizedPaneId);
  const compactPaneId = useWorkspaceStore((state) => state.compactPaneId);
  const visiblePanes = useWorkspaceStore((state) => state.visiblePanes);
  // A phone-width screen shows one pane at a time, picked in the header (see LayoutToolbar); the saved
  // layout and maximize state are left as they are for a wider screen.
  const compact = useCompactLayout();
  const shownPaneId = compact ? compactPaneId : maximizedPaneId;
  const shown = useMemo(() => ({ compact, shownPaneId }), [compact, shownPaneId]);

  return (
    <ShownPaneContext.Provider value={shown}>
      <div
        className={cn("workspace-layout", shownPaneId && "workspace-layout--maximized")}
        data-maximized-pane={shownPaneId ?? undefined}
      >
        {renderLayoutNode(layoutTree, panes, toolbars, titles, visiblePanes)}
      </div>
    </ShownPaneContext.Provider>
  );
}

function renderLayoutNode(
  node: WorkspaceLayoutNode,
  panes: PaneRegistry,
  toolbars: PaneToolbarRegistry,
  titles: PaneTitleRegistry,
  visiblePanes: Record<WorkspacePaneId, boolean>,
): ReactNode {
  if (node.type === "pane") {
    if (!visiblePanes[node.paneId]) return null;

    return (
      <PaneFrame paneId={node.paneId} title={titles[node.paneId]} toolbar={toolbars[node.paneId]}>
        {panes[node.paneId]}
      </PaneFrame>
    );
  }

  const visibleChildren = node.children.filter((child) => hasVisiblePane(child, visiblePanes));

  if (visibleChildren.length === 0) return null;
  if (visibleChildren.length === 1) {
    return renderLayoutNode(visibleChildren[0], panes, toolbars, titles, visiblePanes);
  }

  return (
    <SplitNode
      node={node}
      panes={panes}
      toolbars={toolbars}
      titles={titles}
      visibleChildren={visibleChildren}
      visiblePanes={visiblePanes}
    />
  );
}

function SplitNode({
  node,
  panes,
  toolbars,
  titles,
  visibleChildren,
  visiblePanes,
}: {
  node: Extract<WorkspaceLayoutNode, { type: "split" }>;
  panes: PaneRegistry;
  toolbars: PaneToolbarRegistry;
  titles: PaneTitleRegistry;
  visibleChildren: WorkspaceLayoutNode[];
  visiblePanes: Record<WorkspacePaneId, boolean>;
}) {
  const updateLayoutSplitSizes = useWorkspaceStore((state) => state.updateLayoutSplitSizes);
  const groupRef = useRef<TpResizablePanelGroup>(null);
  const appliedLayout = useRef<string | null>(null);
  const layout = JSON.stringify([
    node.direction,
    Object.fromEntries(visibleChildren.map((child) => [child.id, node.sizes[node.children.indexOf(child)]])),
  ]);

  // Panels read their default size once, when they connect. When the stored sizes or the direction change
  // later (a layout preset), apply them together, once the group has re-measured for its new direction.
  useLayoutEffect(() => {
    const group = groupRef.current;
    if (group && appliedLayout.current !== null && appliedLayout.current !== layout) {
      const [, sizes] = JSON.parse(layout) as [string, Record<string, number>];
      void group.updateComplete.then(() => {
        if (group.isConnected) group.setLayout(sizes);
      });
    }
    appliedLayout.current = layout;
  }, [layout]);

  return (
    <ResizablePanelGroup
      ref={groupRef}
      className="h-full min-h-0 w-full min-w-0"
      orientation={node.direction}
      onLayoutChanged={(layout) => {
        const sizes = node.children.map((child, index) => layout[child.id] ?? node.sizes[index] ?? 0);
        updateLayoutSplitSizes(node.id, sizes);
      }}
    >
      {visibleChildren.map((child, index) => (
        <FragmentWithHandle
          key={child.id}
          child={child}
          index={index}
          panes={panes}
          size={node.sizes[node.children.indexOf(child)]}
          toolbars={toolbars}
          titles={titles}
          visiblePanes={visiblePanes}
        />
      ))}
    </ResizablePanelGroup>
  );
}

function hasVisiblePane(
  node: WorkspaceLayoutNode,
  visiblePanes: Record<WorkspacePaneId, boolean>,
): boolean {
  if (node.type === "pane") return visiblePanes[node.paneId];

  return node.children.some((child) => hasVisiblePane(child, visiblePanes));
}

function FragmentWithHandle({
  child,
  index,
  panes,
  size,
  toolbars,
  titles,
  visiblePanes,
}: {
  child: WorkspaceLayoutNode;
  index: number;
  panes: PaneRegistry;
  size: number;
  toolbars: PaneToolbarRegistry;
  titles: PaneTitleRegistry;
  visiblePanes: Record<WorkspacePaneId, boolean>;
}) {
  return (
    <>
      {index > 0 ? <ResizableHandle withHandle /> : null}
      {/* TweakPad reads string extents as percentages of the group and numbers as pixels. */}
      <ResizablePanel
        className="min-h-0 min-w-0 overflow-hidden"
        defaultSize={`${size}%`}
        id={child.id}
        minSize={18}
      >
        {renderLayoutNode(child, panes, toolbars, titles, visiblePanes)}
      </ResizablePanel>
    </>
  );
}

function PaneFrame({
  children,
  paneId,
  title,
  toolbar,
}: {
  children: ReactNode;
  paneId: WorkspacePaneId;
  title?: ReactNode;
  toolbar?: ReactNode;
}) {
  const { compact, shownPaneId } = useContext(ShownPaneContext);
  const setMaximizedPane = useWorkspaceStore((state) => state.setMaximizedPane);
  const maximized = shownPaneId === paneId;
  const hiddenByMaximize = Boolean(shownPaneId && !maximized);

  return (
    <section
      className={cn(
        "workspace-pane",
        maximized && "workspace-pane--maximized",
        hiddenByMaximize && "workspace-pane--hidden-by-maximize",
      )}
    >
      <div className="workspace-pane__header">
        <div className="workspace-pane__title">{title ?? paneTitle[paneId]}</div>
        <div className="workspace-pane__toolbar">
          {toolbar}
          {compact ? null : (
            <Button
              aria-label={maximized ? `Restore ${paneTitle[paneId]}` : `Maximize ${paneTitle[paneId]}`}
              size="icon"
              title={maximized ? "Restore" : "Maximize"}
              variant="ghost"
              onClick={() => setMaximizedPane(maximized ? null : paneId)}
            >
              {maximized ? <X slot="icon-start" /> : <Maximize2 slot="icon-start" />}
            </Button>
          )}
        </div>
      </div>
      <div className="workspace-pane__body">{children}</div>
    </section>
  );
}
