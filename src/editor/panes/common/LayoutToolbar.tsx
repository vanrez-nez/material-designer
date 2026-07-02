import { LayoutPanelLeft, LayoutPanelTop, X } from "lucide-react";

import { Button } from "@/components/ui/primitives/button";
import { useWorkspaceStore, type WorkspaceLayoutPreset } from "@/store/app";

const presetIcons = {
  "graph-left": LayoutPanelLeft,
  "graph-top": LayoutPanelTop,
} satisfies Record<WorkspaceLayoutPreset, typeof LayoutPanelLeft>;

const presetLabels: Record<WorkspaceLayoutPreset, string> = {
  "graph-left": "Graph left",
  "graph-top": "Graph top",
};

export function LayoutToolbar() {
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
            size="icon"
            title={presetLabels[preset]}
            variant={layoutPreset === preset && !maximizedPaneId ? "default" : "ghost"}
            onClick={() => setLayoutPreset(preset)}
          >
            <Icon className="size-4" />
          </Button>
        );
      })}
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
