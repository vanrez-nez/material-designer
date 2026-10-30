import { useCallback, useMemo } from "react";

import { dispatchControlsDialogMount } from "@/app-events";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/primitives/dialog";

type ControlsDialogProps = {
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

// Modal host for the imperative Tweakpane controls, scoped to the scene preview pane rather than the whole
// window: the dialog renders inside `.scene-host` (container modality), so the dim and dialog sit inside the
// preview pane and only that pane goes inert. The pane element itself is owned by the preview boot module; on
// mount we hand it our body div (via a ref callback, since the content only mounts while open) so boot can
// re-parent the pane into it — mirrors the preview-pane mount handshake.
export function ControlsDialog({ onOpenChange, open }: ControlsDialogProps) {
  // The scene pane host to scope to. Resolved when opening (it always exists while the scene pane is
  // visible); falls back to a page-wide modal if not found.
  const container = useMemo(
    () => (open ? document.querySelector<HTMLElement>(".scene-host") : null),
    [open],
  );

  const hostRef = useCallback((node: HTMLDivElement | null) => {
    if (node) dispatchControlsDialogMount(node);
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent container={container} title="Controls">
        <div ref={hostRef} className="controls-dialog-host" />
      </DialogContent>
    </Dialog>
  );
}
