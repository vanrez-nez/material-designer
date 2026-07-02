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

const paneTitle: Record<WorkspacePaneId, string> = {
  graph: "Graph",
  scene: "Scene",
  "texture-preview": "Textures",
};

export function WorkspaceLayout({
  panes,
  toolbars = {},
}: {
  panes: PaneRegistry;
  toolbars?: PaneToolbarRegistry;
}) {
  const layoutTree = useWorkspaceStore((state) => state.layoutTree);
  const maximizedPaneId = useWorkspaceStore((state) => state.maximizedPaneId);

  return (
    <div
      className={cn("workspace-layout", maximizedPaneId && "workspace-layout--maximized")}
      data-maximized-pane={maximizedPaneId ?? undefined}
    >
      {renderLayoutNode(layoutTree, panes, toolbars)}
    </div>
  );
}

function renderLayoutNode(
  node: WorkspaceLayoutNode,
  panes: PaneRegistry,
  toolbars: PaneToolbarRegistry,
): ReactNode {
  if (node.type === "pane") {
    return (
      <PaneFrame paneId={node.paneId} toolbar={toolbars[node.paneId]}>
        {panes[node.paneId]}
      </PaneFrame>
    );
  }

  return <SplitNode node={node} panes={panes} toolbars={toolbars} />;
}

function SplitNode({
  node,
  panes,
  toolbars,
}: {
  node: Extract<WorkspaceLayoutNode, { type: "split" }>;
  panes: PaneRegistry;
  toolbars: PaneToolbarRegistry;
}) {
  const updateLayoutSplitSizes = useWorkspaceStore((state) => state.updateLayoutSplitSizes);

  return (
    <ResizablePanelGroup
      className="min-h-0 min-w-0"
      orientation={node.direction}
      onLayoutChanged={(layout) => {
        const sizes = node.children.map((child) => layout[child.id] ?? 0);
        updateLayoutSplitSizes(node.id, sizes);
      }}
    >
      {node.children.map((child, index) => (
        <FragmentWithHandle
          key={child.id}
          child={child}
          index={index}
          panes={panes}
          sizes={node.sizes}
          toolbars={toolbars}
        />
      ))}
    </ResizablePanelGroup>
  );
}

function FragmentWithHandle({
  child,
  index,
  panes,
  sizes,
  toolbars,
}: {
  child: WorkspaceLayoutNode;
  index: number;
  panes: PaneRegistry;
  sizes: number[];
  toolbars: PaneToolbarRegistry;
}) {
  return (
    <>
      {index > 0 ? <ResizableHandle withHandle /> : null}
      <ResizablePanel
        className="min-h-0 min-w-0 overflow-hidden"
        defaultSize={sizes[index]}
        id={child.id}
        minSize={18}
      >
        {renderLayoutNode(child, panes, toolbars)}
      </ResizablePanel>
    </>
  );
}

function PaneFrame({
  children,
  paneId,
  toolbar,
}: {
  children: ReactNode;
  paneId: WorkspacePaneId;
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
        <div className="workspace-pane__title">{paneTitle[paneId]}</div>
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
