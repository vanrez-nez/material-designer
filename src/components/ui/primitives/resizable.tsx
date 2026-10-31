import * as React from "react";
import type { TpResizablePanelGroup } from "@tweakpad/ui";
import {
  ResizableHandle as TpResizableHandle,
  type ResizableHandleProps,
  ResizablePanel as TpResizablePanel,
  ResizablePanelGroup as TpResizablePanelGroupBinding,
  type ResizablePanelGroupProps as TpResizablePanelGroupProps,
  type ResizablePanelProps as TpResizablePanelProps,
} from "@tweakpad/ui/react";

import { cn } from "@/lib/utils";

// Panel id → size in percent of the group, as reported when a resize settles.
type Layout = Record<string, number>;

// Panels report the size the caller wants for them; the group applies a changed set as one layout.
const PanelSizesContext = React.createContext<Map<string, number> | null>(null);

type ResizablePanelGroupProps = Omit<TpResizablePanelGroupProps, "onLayoutChanged"> & {
  // Reported once a resize settles.
  onLayoutChanged?: (layout: Layout) => void;
};

// tp-resizable-panel-group lays out its tp-resizable-panel / tp-resizable-handle children (direct children,
// in order) and owns their sizes; nest another group inside a panel for the other axis.
function ResizablePanelGroup({ className, onLayoutChanged, orientation, ...props }: ResizablePanelGroupProps) {
  const ref = React.useRef<TpResizablePanelGroup>(null);
  const requestedSizes = React.useRef(new Map<string, number>()).current;
  const appliedSizes = React.useRef<string | null>(null);

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
      <TpResizablePanelGroupBinding
        ref={ref}
        className={cn("h-full w-full", className)}
        onLayoutChanged={(layout) => onLayoutChanged?.({ ...layout })}
        orientation={orientation}
        {...props}
      />
    </PanelSizesContext.Provider>
  );
}

type ResizablePanelProps = Omit<TpResizablePanelProps, "defaultSize" | "id" | "minSize"> & {
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
    <TpResizablePanel
      data-panel=""
      defaultSize={defaultSize === undefined ? undefined : `${defaultSize}%`}
      id={id}
      minSize={minSize}
      {...props}
    />
  );
}

function ResizableHandle(props: ResizableHandleProps) {
  return <TpResizableHandle data-slot="resizable-handle" {...props} />;
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup };
