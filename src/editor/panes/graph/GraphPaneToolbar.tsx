import {
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
} from "lucide-react";

import { dispatchGraphAutoLayout, type GraphLayoutArrangement } from "@/app-events";
import { Button } from "@/components/ui/primitives/button";
import { useWorkspaceStore } from "@/store/app";

const graphArrangementIcons = {
  down: AlignEndVertical,
  right: AlignEndHorizontal,
  up: AlignStartVertical,
  left: AlignStartHorizontal,
} satisfies Record<GraphLayoutArrangement, typeof AlignEndVertical>;

const graphArrangementLabels: Record<GraphLayoutArrangement, string> = {
  down: "Auto layout down",
  right: "Auto layout right",
  up: "Auto layout up",
  left: "Auto layout left",
};

export function GraphPaneToolbar() {
  const arrangement =
    useWorkspaceStore(
      (state) => state.materialDocument.ui?.editor?.view?.layoutArrangement,
    ) ?? "down";
  const arrangements: GraphLayoutArrangement[] = ["left", "right", "up", "down"];

  return (
    <div className="workspace-pane__toolbar-group" aria-label="Graph layout controls">
      {arrangements.map((nextArrangement) => {
        const Icon = graphArrangementIcons[nextArrangement];

        return (
          <Button
            key={nextArrangement}
            aria-label={graphArrangementLabels[nextArrangement]}
            size="icon"
            title={graphArrangementLabels[nextArrangement]}
            type="button"
            variant={arrangement === nextArrangement ? "secondary" : "ghost"}
            onClick={() => dispatchGraphAutoLayout(nextArrangement)}
          >
            <Icon className="size-3.5" />
          </Button>
        );
      })}
    </div>
  );
}
