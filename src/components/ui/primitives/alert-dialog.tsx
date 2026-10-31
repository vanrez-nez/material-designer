import * as React from "react";
import { AlertDialog as TpAlertDialog } from "@tweakpad/ui/react";

import { withSlot } from "@/components/ui/tp/hooks";

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

// A modal confirmation for a consequential decision. Outside presses never close it. Content stays mounted
// until the close has completed, like DialogContent.
function AlertDialog({ cancel, children, confirm, description, onOpenChange, open, title }: AlertDialogProps) {
  const [present, setPresent] = React.useState(open);
  if (open && !present) setPresent(true);

  return (
    <TpAlertDialog
      description={description}
      label={title}
      onOpenChange={(event) => onOpenChange(event.detail.value)}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen) setPresent(false);
      }}
      open={open}
    >
      {open || present ? (
        <>
          {children}
          {withSlot(cancel, "cancel")}
          {withSlot(confirm, "confirm")}
        </>
      ) : null}
    </TpAlertDialog>
  );
}

export { AlertDialog };
