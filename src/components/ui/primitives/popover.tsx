import * as React from "react";

import { useOpenState, useTpOpenChange, withSlot } from "@/components/ui/tp/hooks";

type PopoverPlacement = { align?: "start" | "center" | "end"; sideOffset?: number };

const PopoverContext = React.createContext<{
  open: boolean;
  setPlacement: (placement: PopoverPlacement) => void;
} | null>(null);

function usePopoverContext(part: string) {
  const context = React.useContext(PopoverContext);
  if (!context) throw new Error(`${part} must be rendered inside <Popover>.`);
  return context;
}

type PopoverProps = {
  children?: React.ReactNode;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
};

// tp-popover hosts the trigger (slot="trigger") and the content (default slot). It renders without a portal
// so the content stays inside the React root: React events and reconciliation keep working, and the popup
// still lands in the top layer.
function Popover({ children, defaultOpen, onOpenChange, open }: PopoverProps) {
  const ref = React.useRef<HTMLElement>(null);
  const [isOpen, setOpen] = useOpenState(open, defaultOpen, onOpenChange);
  useTpOpenChange(ref, isOpen, setOpen);
  const [placement, setPlacement] = React.useState<PopoverPlacement>({});
  const context = React.useMemo(() => ({ open: isOpen, setPlacement }), [isOpen]);

  return (
    <PopoverContext.Provider value={context}>
      <tp-popover
        ref={ref}
        data-slot="popover"
        align={placement.align}
        open={isOpen}
        portal={false}
        side="bottom"
        side-offset={placement.sideOffset}
      >
        {children}
      </tp-popover>
    </PopoverContext.Provider>
  );
}

function PopoverTrigger({ asChild = false, children }: { asChild?: boolean; children?: React.ReactNode }) {
  const { open } = usePopoverContext("PopoverTrigger");
  const state = { "data-slot": "popover-trigger", "data-state": open ? "open" : "closed" };

  if (asChild) return withSlot(children, "trigger", state);
  return (
    <button slot="trigger" type="button" {...state}>
      {children}
    </button>
  );
}

function PopoverContent({
  align = "center",
  children,
  sideOffset = 6,
  ...props
}: React.ComponentProps<"div"> & PopoverPlacement) {
  const { open, setPlacement } = usePopoverContext("PopoverContent");

  React.useLayoutEffect(() => setPlacement({ align, sideOffset }), [align, sideOffset, setPlacement]);

  // The wrapper stays mounted (a stable slotted child); its content mounts only while open, as before.
  return (
    <div data-slot="popover-content" {...props}>
      {open ? children : null}
    </div>
  );
}

export { Popover, PopoverTrigger, PopoverContent };
