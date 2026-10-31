import { Box, Images, LayoutPanelLeft, LayoutPanelTop, Workflow, X } from "lucide-react";

import { Button } from "@/components/ui/primitives/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/primitives/toggle-group";
import { useCompactLayout } from "@/lib/use-compact-layout";
import { useWorkspaceStore, type WorkspaceLayoutPreset, type WorkspacePaneId } from "@/store/app";

const presetIcons = {
  "graph-left": LayoutPanelLeft,
  "graph-top": LayoutPanelTop,
} satisfies Record<WorkspaceLayoutPreset, typeof LayoutPanelLeft>;

const presetLabels: Record<WorkspaceLayoutPreset, string> = {
  "graph-left": "Graph left",
  "graph-top": "Graph top",
};

const panes: Array<{ icon: typeof Workflow; id: WorkspacePaneId; label: string }> = [
  { icon: Workflow, id: "graph", label: "Graph" },
  { icon: Box, id: "scene", label: "Scene" },
  { icon: Images, id: "texture-preview", label: "Textures" },
];

export function LayoutToolbar() {
  const compact = useCompactLayout();
  return compact ? <PaneSwitcher /> : <LayoutPresets />;
}

// A compact screen shows one pane at a time: the header picks which.
function PaneSwitcher() {
  const compactPaneId = useWorkspaceStore((state) => state.compactPaneId);
  const setCompactPane = useWorkspaceStore((state) => state.setCompactPane);
  const visiblePanes = useWorkspaceStore((state) => state.visiblePanes);

  return (
    <ToggleGroup
      className="workspace-layout-controls"
      label="Shown pane"
      onValueChange={(paneId) => setCompactPane(paneId as WorkspacePaneId)}
      size="icon-sm"
      value={compactPaneId}
    >
      {panes
        .filter((pane) => visiblePanes[pane.id])
        .map(({ icon: Icon, id, label }) => (
          <ToggleGroupItem key={id} aria-label={label} title={label} value={id}>
            <Icon aria-hidden size="1em" />
          </ToggleGroupItem>
        ))}
    </ToggleGroup>
  );
}

function LayoutPresets() {
  const layoutPreset = useWorkspaceStore((state) => state.layoutPreset);
  const maximizedPaneId = useWorkspaceStore((state) => state.maximizedPaneId);
  const restoreWorkspaceLayout = useWorkspaceStore((state) => state.restoreWorkspaceLayout);
  const setLayoutPreset = useWorkspaceStore((state) => state.setLayoutPreset);
  const presets: WorkspaceLayoutPreset[] = ["graph-left", "graph-top"];

  return (
    <div className="workspace-layout-controls" aria-label="Layout controls">
      {presets.map((preset) => {
        const Icon = presetIcons[preset];

        return (
          <Button
            key={preset}
            aria-label={presetLabels[preset]}
            size="icon-sm"
            title={presetLabels[preset]}
            variant={layoutPreset === preset && !maximizedPaneId ? "default" : "ghost"}
            onClick={() => setLayoutPreset(preset)}
          >
            <Icon />
          </Button>
        );
      })}
      {maximizedPaneId ? (
        <Button
          aria-label="Restore panes"
          size="icon-sm"
          title="Restore panes"
          variant="secondary"
          onClick={restoreWorkspaceLayout}
        >
          <X />
        </Button>
      ) : null}
    </div>
  );
}
