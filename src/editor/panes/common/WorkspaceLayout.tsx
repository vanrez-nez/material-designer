import { type ReactNode } from "react";
import { Maximize2, X } from "lucide-react";

import { Button } from "@/components/ui/primitives/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/primitives/resizable";
import { cn } from "@/lib/utils";
import {
  useWorkspaceStore,
  type WorkspaceLayoutNode,
  type WorkspacePaneId,
} from "@/store/app";

type PaneRegistry = Record<WorkspacePaneId, ReactNode>;
type PaneToolbarRegistry = Partial<Record<WorkspacePaneId, ReactNode>>;
type PaneTitleRegistry = Partial<Record<WorkspacePaneId, ReactNode>>;

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
  const visiblePanes = useWorkspaceStore((state) => state.visiblePanes);

  return (
    <div
      className={cn("workspace-layout", maximizedPaneId && "workspace-layout--maximized")}
      data-maximized-pane={maximizedPaneId ?? undefined}
    >
      {renderLayoutNode(layoutTree, panes, toolbars, titles, visiblePanes)}
    </div>
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

  return (
    <ResizablePanelGroup
      className="min-h-0 min-w-0"
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
      <ResizablePanel
        className="min-h-0 min-w-0 overflow-hidden"
        defaultSize={size}
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
  const maximizedPaneId = useWorkspaceStore((state) => state.maximizedPaneId);
  const setMaximizedPane = useWorkspaceStore((state) => state.setMaximizedPane);
  const maximized = maximizedPaneId === paneId;
  const hiddenByMaximize = Boolean(maximizedPaneId && !maximized);

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
          <Button
            aria-label={maximized ? `Restore ${paneTitle[paneId]}` : `Maximize ${paneTitle[paneId]}`}
            size="icon"
            title={maximized ? "Restore" : "Maximize"}
            variant="ghost"
            onClick={() => setMaximizedPane(maximized ? null : paneId)}
          >
            {maximized ? <X className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </Button>
        </div>
      </div>
      <div className="workspace-pane__body">{children}</div>
    </section>
  );
}
