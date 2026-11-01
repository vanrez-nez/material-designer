import { Alert, AlertDialog, Button } from "@tweakpad/ui/react";

import { clearSession } from "@/lib/clear-session";

type ClearSessionDialogProps = {
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

export function ClearSessionDialog({ onOpenChange, open }: ClearSessionDialogProps) {
  return (
    <AlertDialog
      backdrop="blur"
      description="Permanently clears all locally stored Material Designer data — saved and autosaved materials, layout, renderer, and editor settings — then reloads the app to a clean state."
      label="Clear Session"
      onOpenChange={(event) => onOpenChange(event.detail.value)}
      open={open}
    >
      <Alert severity="danger" title="This cannot be undone">
        Any material you have not exported or saved outside the app will be permanently lost.
      </Alert>
      <Button slot="cancel" variant="ghost">
        Cancel
      </Button>
      <Button slot="confirm" variant="destructive" onClick={() => clearSession()}>
        Clear Session
      </Button>
    </AlertDialog>
  );
}
