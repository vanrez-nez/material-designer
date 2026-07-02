import { useEffect, useMemo, useState } from "react";

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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/primitives/tooltip";
import { cn } from "@/lib/utils";
import { formatAbsoluteDateTime, formatRelativeTime } from "@/lib/datetime";
import { listDocuments, useDocumentLibraryStore } from "@/store/document-library";

type OpenDocumentDialogProps = {
  onOpenChange: (open: boolean) => void;
  onOpen: (id: string) => void;
  open: boolean;
};

export function OpenDocumentDialog({ onOpen, onOpenChange, open }: OpenDocumentDialogProps) {
  const documents = useDocumentLibraryStore((state) => state.documents);
  const activeId = useDocumentLibraryStore((state) => state.activeId);
  const entries = useMemo(() => listDocuments(documents), [documents]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Re-render periodically while open so the relative "last modified" text stays fresh.
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!open) return;
    setSelectedId(activeId ?? entries[0]?.id ?? null);
  }, [open, activeId, entries]);

  useEffect(() => {
    if (!open) return undefined;
    const interval = setInterval(() => setTick((tick) => tick + 1), 30_000);
    return () => clearInterval(interval);
  }, [open]);

  function handleOpen(): void {
    if (!selectedId) return;
    onOpen(selectedId);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Open Document</DialogTitle>
          <DialogDescription>Pick a saved document to open.</DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto rounded-md border">
          {entries.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No saved documents yet.</p>
          ) : (
            <TooltipProvider>
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Title</th>
                    <th className="px-3 py-2 text-right font-medium">Last modified</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr
                      key={entry.id}
                      className={cn(
                        "cursor-pointer border-t border-border/60 transition-colors hover:bg-accent",
                        selectedId === entry.id && "bg-accent",
                      )}
                      aria-selected={selectedId === entry.id}
                      onClick={() => setSelectedId(entry.id)}
                      onDoubleClick={() => {
                        setSelectedId(entry.id);
                        onOpen(entry.id);
                        onOpenChange(false);
                      }}
                    >
                      <td className="truncate px-3 py-2">{entry.title}</td>
                      <td className="px-3 py-2 text-right text-muted-foreground">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-default">{formatRelativeTime(entry.updatedAt)}</span>
                          </TooltipTrigger>
                          <TooltipContent>{formatAbsoluteDateTime(entry.updatedAt)}</TooltipContent>
                        </Tooltip>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TooltipProvider>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" disabled={!selectedId} onClick={handleOpen}>
            Open
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
