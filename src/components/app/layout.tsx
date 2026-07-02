import { useState, type ReactNode } from "react";
import {
  Columns2,
  Maximize2,
  PanelBottom,
  PanelLeft,
  PanelRight,
  PanelTop,
  Rows2,
  X,
} from "lucide-react";

import { AppMenu } from "@/components/app/menu/AppMenu";
import { DocumentExportDialog } from "@/components/app/dialogs/DocumentExportDialog";
import { TextureExportDialog } from "@/components/app/dialogs/TextureExportDialog";
import { TexturePreviewPane } from "@/components/app/texture-preview-pane";
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
  type WorkspaceLayoutPreset,
  type WorkspacePaneId,
} from "@/store/app";

type PaneRegistry = Record<WorkspacePaneId, ReactNode>;

const paneTitle: Record<WorkspacePaneId, string> = {
  graph: "Graph",
  scene: "Scene",
  "texture-preview": "Textures",
};

const presetIcons = {
  "graph-left": PanelLeft,
  "graph-right": PanelRight,
  "graph-top": PanelTop,
  "graph-bottom": PanelBottom,
} satisfies Record<WorkspaceLayoutPreset, typeof PanelLeft>;

const presetLabels: Record<WorkspaceLayoutPreset, string> = {
  "graph-left": "Graph left",
  "graph-right": "Graph right",
  "graph-top": "Graph top",
  "graph-bottom": "Graph bottom",
};

export function Layout() {
  const [isDocumentExportOpen, setIsDocumentExportOpen] = useState(false);
  const [isTextureExportOpen, setIsTextureExportOpen] = useState(false);

  return (
    <>
      <div className="workspace-shell">
        <header className="workspace-header">
          <AppMenu
            onExportDocument={() => setIsDocumentExportOpen(true)}
            onExportTextures={() => setIsTextureExportOpen(true)}
          />
          <LayoutToolbar />
        </header>
        <main id="app" className="workspace-body">
          <WorkspaceLayout
            panes={{
              graph: <div className="graph-host" />,
              scene: (
                <div className="preview-host">
                  <canvas className="scene" />
                  <div className="pane-host" />
                </div>
              ),
              "texture-preview": <TexturePreviewPane />,
            }}
          />
        </main>
      </div>
      <DocumentExportDialog open={isDocumentExportOpen} onOpenChange={setIsDocumentExportOpen} />
      <TextureExportDialog open={isTextureExportOpen} onOpenChange={setIsTextureExportOpen} />
    </>
  );
}

function LayoutToolbar() {
  const layoutPreset = useWorkspaceStore((state) => state.layoutPreset);
  const maximizedPaneId = useWorkspaceStore((state) => state.maximizedPaneId);
  const restoreWorkspaceLayout = useWorkspaceStore((state) => state.restoreWorkspaceLayout);
  const setLayoutPreset = useWorkspaceStore((state) => state.setLayoutPreset);
  const resetWorkspaceLayout = useWorkspaceStore((state) => state.resetWorkspaceLayout);
  const presets: WorkspaceLayoutPreset[] = [
    "graph-left",
    "graph-right",
    "graph-top",
    "graph-bottom",
  ];

  return (
    <div className="workspace-layout-controls" aria-label="Layout controls">
      {presets.map((preset) => {
        const Icon = presetIcons[preset];

        return (
          <Button
            key={preset}
            aria-label={presetLabels[preset]}
            size="icon"
            title={presetLabels[preset]}
            variant={layoutPreset === preset && !maximizedPaneId ? "default" : "ghost"}
            onClick={() => setLayoutPreset(preset)}
          >
            <Icon className="size-4" />
          </Button>
        );
      })}
      <Button
        aria-label="Reset layout"
        size="icon"
        title="Reset layout"
        variant="ghost"
        onClick={resetWorkspaceLayout}
      >
        <Columns2 className="size-4 hidden sm:block" />
        <Rows2 className="size-4 sm:hidden" />
      </Button>
      {maximizedPaneId ? (
        <Button
          aria-label="Restore panes"
          size="icon"
          title="Restore panes"
          variant="secondary"
          onClick={restoreWorkspaceLayout}
        >
          <X className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}

function WorkspaceLayout({ panes }: { panes: PaneRegistry }) {
  const layoutTree = useWorkspaceStore((state) => state.layoutTree);
  const maximizedPaneId = useWorkspaceStore((state) => state.maximizedPaneId);

  return (
    <div
      className={cn("workspace-layout", maximizedPaneId && "workspace-layout--maximized")}
      data-maximized-pane={maximizedPaneId ?? undefined}
    >
      {renderLayoutNode(layoutTree, panes)}
    </div>
  );
}

function renderLayoutNode(node: WorkspaceLayoutNode, panes: PaneRegistry): ReactNode {
  if (node.type === "pane") {
    return <PaneFrame paneId={node.paneId}>{panes[node.paneId]}</PaneFrame>;
  }

  return <SplitNode node={node} panes={panes} />;
}

function SplitNode({
  node,
  panes,
}: {
  node: Extract<WorkspaceLayoutNode, { type: "split" }>;
  panes: PaneRegistry;
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
}: {
  child: WorkspaceLayoutNode;
  index: number;
  panes: PaneRegistry;
  sizes: number[];
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
        {renderLayoutNode(child, panes)}
      </ResizablePanel>
    </>
  );
}

function PaneFrame({ children, paneId }: { children: ReactNode; paneId: WorkspacePaneId }) {
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
      <div className="workspace-pane__body">{children}</div>
    </section>
  );
}
