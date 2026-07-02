import {
  Columns2,
  PanelBottom,
  PanelLeft,
  PanelRight,
  PanelTop,
  Rows2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/primitives/button";
import { useWorkspaceStore, type WorkspaceLayoutPreset } from "@/store/app";

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

export function LayoutToolbar() {
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
