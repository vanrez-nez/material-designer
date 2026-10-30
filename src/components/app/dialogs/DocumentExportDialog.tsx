import { useEffect, useState } from "react";

import metadataHelp from "@/help/document-metadata.md?raw";
import {
  copyDocumentExportToClipboard,
  downloadDocumentExport,
} from "@/editor/panes/graph/document-export";
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
import { Field } from "@/components/ui/primitives/field";
import { parseHelpDoc } from "@/components/ui/composables/help-hint";
import { useWorkspaceStore } from "@/store/app";

const metadataSummary = parseHelpDoc(metadataHelp).description;

type DocumentExportDialogProps = {
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

export function DocumentExportDialog({ onOpenChange, open }: DocumentExportDialogProps) {
  const document = useWorkspaceStore((state) => state.materialDocument);
  const [includeMetadata, setIncludeMetadata] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      setIncludeMetadata(true);
      setCopied(false);
    }
  }, [open]);

  function handleExport(): void {
    downloadDocumentExport(document, { includeMetadata });
    onOpenChange(false);
  }

  async function handleCopy(): Promise<void> {
    await copyDocumentExportToClipboard(document, { includeMetadata });
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export Document</DialogTitle>
          <DialogDescription>
            Save the current material graph as a JSON document.
          </DialogDescription>
        </DialogHeader>

        <Field description={metadataSummary} label="Include document metadata" orientation="horizontal">
          <Checkbox checked={includeMetadata} onCheckedChange={setIncludeMetadata} />
        </Field>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" variant="outline" onClick={() => void handleCopy()}>
            {copied ? "Copied!" : "Copy to Clipboard"}
          </Button>
          <Button type="button" onClick={handleExport}>
            Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
