import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Dialog,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Time,
} from "@tweakpad/ui/react";

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
    <Dialog
      description="Pick a saved document to open."
      label="Open Document"
      onOpenChange={(event) => onOpenChange(event.detail.value)}
      open={open}
    >
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
                  <Button size="xs" variant="link">
                    {entry.title}
                  </Button>
                </TableHead>
                <TableCell className="document-table__modified">
                  <Time datetime={entry.updatedAt} mode="relative" numeric="always" tooltip={false} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Button slot="footer" variant="ghost" onClick={() => onOpenChange(false)}>
        Cancel
      </Button>
      <Button slot="footer" disabled={!selectedId} onClick={handleOpen}>
        Open
      </Button>
    </Dialog>
  );
}
