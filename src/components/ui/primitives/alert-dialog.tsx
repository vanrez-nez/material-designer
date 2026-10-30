import * as React from "react";

import { type TpValueChangeDetail, useTpEvent, useTpOpenChange, withSlot } from "@/components/ui/tp/hooks";

type AlertDialogProps = {
  // The named decisions: Cancel (and Escape) close the dialog; Confirm runs the caller's own handler.
  cancel: React.ReactElement;
  children?: React.ReactNode;
  confirm: React.ReactElement;
  description?: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
};

// A modal confirmation for a consequential decision (tp-alert-dialog). Outside presses never close it.
// Content stays mounted until the close has completed, like DialogContent.
function AlertDialog({ cancel, children, confirm, description, onOpenChange, open, title }: AlertDialogProps) {
  const ref = React.useRef<HTMLElement>(null);
  const [present, setPresent] = React.useState(open);
  if (open && !present) setPresent(true);
  useTpOpenChange(ref, open, onOpenChange);
  useTpEvent<TpValueChangeDetail<boolean>>(ref, "tp-open-change-complete", (event) => {
    if (event.target === ref.current && !event.detail.value) setPresent(false);
  });

  return (
    <tp-alert-dialog ref={ref} data-slot="alert-dialog" description={description} label={title} open={open}>
      {open || present ? (
        <>
          {children}
          {withSlot(cancel, "cancel")}
          {withSlot(confirm, "confirm")}
        </>
      ) : null}
    </tp-alert-dialog>
  );
}

export { AlertDialog };
