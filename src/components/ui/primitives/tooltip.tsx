import * as React from "react";

import { withSlot } from "@/components/ui/tp/hooks";

const TooltipDelayContext = React.createContext(200);

function TooltipProvider({
  children,
  delayDuration = 200,
}: {
  children?: React.ReactNode;
  delayDuration?: number;
}) {
  return <TooltipDelayContext.Provider value={delayDuration}>{children}</TooltipDelayContext.Provider>;
}

// tp-tooltip hosts the trigger (slot="trigger") and the tip text (default slot); it opens on hover/focus.
function Tooltip({ children }: { children?: React.ReactNode }) {
  const delay = React.useContext(TooltipDelayContext);

  return (
    <tp-tooltip data-slot="tooltip" open-delay={delay}>
      {children}
    </tp-tooltip>
  );
}

function TooltipTrigger({ asChild = false, children }: { asChild?: boolean; children?: React.ReactNode }) {
  if (asChild) return withSlot(children, "trigger", { "data-slot": "tooltip-trigger" });
  return (
    <span slot="trigger" data-slot="tooltip-trigger">
      {children}
    </span>
  );
}

function TooltipContent(props: React.ComponentProps<"span">) {
  return <span data-slot="tooltip-content" {...props} />;
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
