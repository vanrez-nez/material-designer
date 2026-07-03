import { ChevronRight } from "lucide-react";

import { dispatchGraphNavigate } from "@/app-events";
import { cn } from "@/lib/utils";
import { GROUP_TYPE, type GraphNode, type MaterialGraphDocument } from "@/runtime";
import { useWorkspaceStore } from "@/store/app";

// Labels for each entered group, walking the document along the group-navigation path.
function groupTrailLabels(document: MaterialGraphDocument, path: string[]): string[] {
  const labels: string[] = [];
  let nodes: GraphNode[] = document.nodes;
  for (const id of path) {
    const group = nodes.find((node) => node.id === id && node.type === GROUP_TYPE);
    if (!group?.subgraph) break;
    labels.push(group.label?.trim() || "Group");
    nodes = group.subgraph.nodes;
  }
  return labels;
}

// The graph pane's title: a breadcrumb of the group-navigation trail — "Graph" at the root, then
// "Graph › <group>" as the user descends into node groups. Each crumb exits the trail to its depth.
export function GraphPaneTitle() {
  const document = useWorkspaceStore((state) => state.materialDocument);
  const groupPath = useWorkspaceStore((state) => state.materialGroupPath);
  const crumbs = ["Graph", ...groupTrailLabels(document, groupPath)];

  return (
    <div className="pane-breadcrumb">
      {crumbs.map((label, index) => {
        const isCurrent = index === crumbs.length - 1;

        return (
          <span key={index} className="pane-breadcrumb__item">
            {index > 0 ? (
              <ChevronRight className="pane-breadcrumb__sep size-3" aria-hidden />
            ) : null}
            <button
              type="button"
              className={cn(
                "pane-breadcrumb__crumb",
                isCurrent && "pane-breadcrumb__crumb--current",
              )}
              disabled={isCurrent}
              onClick={() => dispatchGraphNavigate(index)}
            >
              {label}
            </button>
          </span>
        );
      })}
    </div>
  );
}
