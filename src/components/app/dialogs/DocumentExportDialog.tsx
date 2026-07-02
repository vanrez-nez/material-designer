import { useEffect, useState } from "react";

import metadataHelp from "@/help/document-metadata.md?raw";
import { downloadDocumentExport } from "@/editor/panes/graph/document-export";
import { Button } from "@/components/ui/primitives/button";
import { Checkbox } from "@/components/ui/primitives/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/primitives/dialog";
import { HelpHint } from "@/components/ui/composables/help-hint";
import { useWorkspaceStore } from "@/store/app";

type DocumentExportDialogProps = {
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

export function DocumentExportDialog({ onOpenChange, open }: DocumentExportDialogProps) {
  const document = useWorkspaceStore((state) => state.materialDocument);
  const [includeMetadata, setIncludeMetadata] = useState(true);

  useEffect(() => {
    if (open) setIncludeMetadata(true);
  }, [open]);

  function handleExport(): void {
    downloadDocumentExport(document, { includeMetadata });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export Document</DialogTitle>
          <DialogDescription>
            Save the current material graph as a JSON document.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border bg-muted/20 p-3">
          <label
            className="flex cursor-pointer items-center justify-between gap-3 text-sm"
            htmlFor="document-export-include-metadata"
          >
            <span className="flex items-center gap-1.5">
              Include document metadata
              <HelpHint
                ariaLabel="Document metadata help"
                doc={metadataHelp}
                size="xs"
                trigger="hover"
              />
            </span>
            <Checkbox
              checked={includeMetadata}
              id="document-export-include-metadata"
              onCheckedChange={(checked) => setIncludeMetadata(checked === true)}
            />
          </label>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" onClick={handleExport}>
            Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
