import { Button } from "@/components/ui/primitives/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/primitives/dialog";
import { clearSession } from "@/lib/clear-session";

type ClearSessionDialogProps = {
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

export function ClearSessionDialog({ onOpenChange, open }: ClearSessionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Clear Session</DialogTitle>
          <DialogDescription>
            Permanently clears all locally stored Material Designer data — saved and autosaved
            materials, layout, renderer, and editor settings — then reloads the app to a clean state.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-muted-foreground">
          Any material you have not exported or saved outside the app will be permanently lost. This
          cannot be undone.
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" variant="destructive" onClick={() => clearSession()}>
            Clear Session
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
