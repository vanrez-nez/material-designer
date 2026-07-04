import {
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
} from "lucide-react";

import { dispatchGraphAutoLayout, type GraphLayoutArrangement } from "@/app-events";
import { Button } from "@/components/ui/primitives/button";
import { GROUP_TYPE, type MaterialGraphDocument } from "@/runtime";
import { useWorkspaceStore } from "@/store/app";

// The arrangement lives in the *active* graph's editor view state, which is the current group's subgraph
// while the user is navigated into a group — not always the root document. Walk the group path the same
// way the controller's active() does so the toolbar reflects the graph actually on screen.
function activeArrangement(
  document: MaterialGraphDocument,
  groupPath: readonly string[],
): GraphLayoutArrangement {
  let graph = document;
  for (const id of groupPath) {
    const group = graph.nodes.find((node) => node.id === id && node.type === GROUP_TYPE);
    if (!group?.subgraph) break;
    graph = group.subgraph;
  }
  return graph.ui?.editor?.view?.layoutArrangement ?? "down";
}

// The align icon's edge matches the flow direction: bars pushed to the bottom = down, top = up,
// right = right, left = left.
const graphArrangementIcons = {
  down: AlignEndHorizontal,
  up: AlignStartHorizontal,
  right: AlignEndVertical,
  left: AlignStartVertical,
} satisfies Record<GraphLayoutArrangement, typeof AlignEndHorizontal>;

const graphArrangementLabels: Record<GraphLayoutArrangement, string> = {
  down: "Auto layout down",
  right: "Auto layout right",
  up: "Auto layout up",
  left: "Auto layout left",
};

export function GraphPaneToolbar() {
  const arrangement = useWorkspaceStore((state) =>
    activeArrangement(state.materialDocument, state.materialGroupPath),
  );
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
