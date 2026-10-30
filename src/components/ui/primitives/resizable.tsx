import * as React from "react";
import type { TpResizablePanelGroup } from "@tweakpad/ui";

import { cn } from "@/lib/utils";
import { useTpEvent } from "@/components/ui/tp/hooks";

// Panel id → size in percent of the group, as reported when a resize settles.
type Layout = Record<string, number>;

// Panels report the size the caller wants for them; the group applies a changed set as one layout.
const PanelSizesContext = React.createContext<Map<string, number> | null>(null);

type ResizablePanelGroupProps = Omit<React.HTMLAttributes<HTMLElement>, "onChange"> & {
  onLayoutChanged?: (layout: Layout) => void;
  orientation?: "horizontal" | "vertical";
};

// tp-resizable-panel-group lays out its tp-resizable-panel / tp-resizable-handle children (direct children,
// in order) and owns their sizes; nest another group inside a panel for the other axis.
function ResizablePanelGroup({ className, onLayoutChanged, orientation, ...props }: ResizablePanelGroupProps) {
  const ref = React.useRef<TpResizablePanelGroup>(null);
  const requestedSizes = React.useRef(new Map<string, number>()).current;
  const appliedSizes = React.useRef<string | null>(null);

  useTpEvent<{ layout: Layout }>(ref, "tp-layout-change-complete", (event) => {
    if (event.target !== ref.current) return;
    onLayoutChanged?.(event.detail.layout);
  });

  // Panels read their default size once, on connect. When the caller later asks for different sizes or
  // flips the orientation (e.g. a layout preset), apply the requested sizes together; this runs after the
  // panels' own effects. The group must first process its new properties (an orientation change re-measures
  // the panels), so the layout is applied once its update completes.
  React.useLayoutEffect(() => {
    const layout = Object.fromEntries(requestedSizes);
    const key = JSON.stringify([orientation, layout]);
    const group = ref.current;
    if (group && appliedSizes.current !== null && appliedSizes.current !== key) {
      void group.updateComplete.then(() => {
        if (group.isConnected) group.setLayout(layout);
      });
    }
    appliedSizes.current = key;
  });

  return (
    <PanelSizesContext.Provider value={requestedSizes}>
      <tp-resizable-panel-group
        ref={ref}
        data-slot="resizable-panel-group"
        className={cn("h-full w-full", className)}
        orientation={orientation}
        {...props}
      />
    </PanelSizesContext.Provider>
  );
}

type ResizablePanelProps = React.HTMLAttributes<HTMLElement> & {
  // Percent of the group.
  defaultSize?: number;
  id: string;
  // Pixels.
  minSize?: number;
};

// Set as properties: TweakPad reads string extents as percentages and numbers as pixels.
function ResizablePanel({ defaultSize, id, minSize, ...props }: ResizablePanelProps) {
  const requestedSizes = React.useContext(PanelSizesContext);

  React.useLayoutEffect(() => {
    if (!requestedSizes || defaultSize === undefined) return undefined;
    requestedSizes.set(id, defaultSize);
    return () => {
      requestedSizes.delete(id);
    };
  }, [defaultSize, id, requestedSizes]);

  return (
    <tp-resizable-panel
      data-slot="resizable-panel"
      data-panel=""
      defaultSize={defaultSize === undefined ? undefined : `${defaultSize}%`}
      id={id}
      minSize={minSize}
      {...props}
    />
  );
}

function ResizableHandle({ withHandle, ...props }: React.HTMLAttributes<HTMLElement> & { withHandle?: boolean }) {
  return <tp-resizable-handle data-slot="resizable-handle" withHandle={withHandle} {...props} />;
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup };
