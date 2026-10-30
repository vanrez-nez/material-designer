import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/primitives/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
} from "@/components/ui/primitives/dialog";
import { EmptyState } from "@/components/ui/primitives/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/primitives/table";
import { Time } from "@/components/ui/primitives/time";
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
      <DialogContent description="Pick a saved document to open." title="Open Document">

        {entries.length === 0 ? (
          <EmptyState title="No saved documents yet." />
        ) : (
          <Table className="document-table" label="Saved documents" selectionPresentation="row" stickyHeader>
            <TableHeader>
              <TableRow>
                <TableHead>File name</TableHead>
                <TableHead className="document-table__modified">Last modified</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow
                  key={entry.id}
                  onClick={() => setSelectedId(entry.id)}
                  onDoubleClick={() => {
                    setSelectedId(entry.id);
                    onOpen(entry.id);
                    onOpenChange(false);
                  }}
                  selected={entry.id === selectedId}
                >
                  <TableHead scope="row">
                    <Button size="xs" type="button" variant="link">
                      {entry.title}
                    </Button>
                  </TableHead>
                  <TableCell className="document-table__modified">
                    <Time value={entry.updatedAt} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
