import { useEffect, useMemo, useRef } from "react";
import { Dialog } from "@tweakpad/ui/react";

import { dispatchControlsDialogMount } from "@/app-events";

type ControlsDialogProps = {
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

// Modal host for the imperative Controls panel (debug/controls.ts), scoped to the scene preview pane rather
// than the whole window: the dialog renders inside `.scene-host` (container modality), so the dim and
// dialog sit inside the preview pane and only that pane goes inert. The panel element itself is owned by
// the preview boot module; each time the dialog opens we hand it our body div so boot can re-parent the
// panel into it — mirrors the preview-pane mount handshake.
export function ControlsDialog({ onOpenChange, open }: ControlsDialogProps) {
  // The scene pane host to scope to. Resolved when opening (it always exists while the scene pane is
  // visible); falls back to a page-wide modal if not found.
  const container = useMemo(
    () => (open ? document.querySelector<HTMLElement>(".scene-host") : null),
    [open],
  );
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && hostRef.current) dispatchControlsDialogMount(hostRef.current);
  }, [open]);

  return (
    <Dialog
      container={container}
      label="Controls"
      modality={container ? "container" : "modal"}
      onOpenChange={(event) => onOpenChange(event.detail.value)}
      open={open}
    >
      <div ref={hostRef} className="controls-dialog-host" />
    </Dialog>
  );
}
