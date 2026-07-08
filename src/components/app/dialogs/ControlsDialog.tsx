import { useCallback, useEffect, useState } from "react";
import { XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { dispatchControlsDialogMount } from "@/app-events";
import { cn } from "@/lib/utils";

type ControlsDialogProps = {
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

// Modal host for the imperative Tweakpane controls, scoped to the scene preview pane rather than the whole
// window: the overlay + centered box are portaled into `.scene-host` and absolutely positioned, so the dim
// and dialog sit inside the preview pane. The pane element itself is owned by the preview boot module; on
// mount we hand it our body div (via a ref callback, since the content only mounts while open) so boot can
// re-parent the pane into it — mirrors the preview-pane mount handshake.
export function ControlsDialog({ onOpenChange, open }: ControlsDialogProps) {
  // The scene pane host to portal into. Resolved when opening (it always exists while the scene pane is
  // visible); falls back to the default body portal if not found.
  const [container, setContainer] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (open) setContainer(document.querySelector<HTMLElement>(".scene-host"));
  }, [open]);

  const hostRef = useCallback((node: HTMLDivElement | null) => {
    if (node) dispatchControlsDialogMount(node);
  }, []);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal container={container ?? undefined}>
        <DialogPrimitive.Overlay
          className={cn(
            "absolute inset-0 z-40 bg-black/50",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            "absolute top-1/2 left-1/2 z-40 grid w-[min(23rem,calc(100%-2rem))] max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-background p-6 shadow-lg outline-none",
            "duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          )}
        >
          <div className="flex flex-col gap-2 text-center sm:text-left">
            <DialogPrimitive.Title className="text-lg leading-none font-semibold">
              Controls
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              Projection, scene lighting, and renderer settings for the material preview.
            </DialogPrimitive.Description>
          </div>
          <div ref={hostRef} className="controls-dialog-host" />
          <DialogPrimitive.Close className="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4">
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
