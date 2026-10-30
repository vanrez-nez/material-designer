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
import { EmptyState } from "@/components/ui/primitives/empty-state";
import { ScrollArea } from "@/components/ui/primitives/scroll-area";
import { Time } from "@/components/ui/primitives/time";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/primitives/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/primitives/tooltip";
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

  useEffect(() => {
    if (!open) return;
    setSelectedId(activeId ?? entries[0]?.id ?? null);
  }, [open, activeId, entries]);

  function handleOpen(): void {
    if (!selectedId) return;
    onOpen(selectedId);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Open Document</DialogTitle>
          <DialogDescription>Pick a saved document to open.</DialogDescription>
        </DialogHeader>

        {entries.length === 0 ? (
          <EmptyState title="No saved documents yet." />
        ) : (
          <ScrollArea className="toggle-list open-document-list" label="Saved documents">
            <TooltipProvider>
              <ToggleGroup
                label="Saved documents"
                onValueChange={setSelectedId}
                orientation="vertical"
                value={selectedId ?? ""}
              >
                {entries.map((entry) => (
                  <Tooltip key={entry.id}>
                    <TooltipTrigger asChild>
                      <ToggleGroupItem
                          value={entry.id}
                        onDoubleClick={() => {
                          setSelectedId(entry.id);
                          onOpen(entry.id);
                          onOpenChange(false);
                        }}
                      >
                        <span className="toggle-list__name">{entry.title}</span>
                        <Time className="toggle-list__detail" value={entry.updatedAt} />
                      </ToggleGroupItem>
                    </TooltipTrigger>
                    <TooltipContent>
                      <Time mode="absolute" value={entry.updatedAt} />
                    </TooltipContent>
                  </Tooltip>
                ))}
              </ToggleGroup>
            </TooltipProvider>
          </ScrollArea>
        )}

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
