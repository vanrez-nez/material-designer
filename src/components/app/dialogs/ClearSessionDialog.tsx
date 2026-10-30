import { Alert } from "@/components/ui/primitives/alert";
import { AlertDialog } from "@/components/ui/primitives/alert-dialog";
import { Button } from "@/components/ui/primitives/button";
import { clearSession } from "@/lib/clear-session";

type ClearSessionDialogProps = {
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

export function ClearSessionDialog({ onOpenChange, open }: ClearSessionDialogProps) {
  return (
    <AlertDialog
      cancel={<Button variant="ghost">Cancel</Button>}
      confirm={
        <Button variant="destructive" onClick={() => clearSession()}>
          Clear Session
        </Button>
      }
      description="Permanently clears all locally stored Material Designer data — saved and autosaved materials, layout, renderer, and editor settings — then reloads the app to a clean state."
      onOpenChange={onOpenChange}
      open={open}
      title="Clear Session"
    >
      <Alert severity="danger" title="This cannot be undone">
        Any material you have not exported or saved outside the app will be permanently lost.
      </Alert>
    </AlertDialog>
  );
}
