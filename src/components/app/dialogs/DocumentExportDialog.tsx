import { useEffect, useState } from "react";
import { Button, Checkbox, Dialog, Field } from "@tweakpad/ui/react";

import {
  copyDocumentExportToClipboard,
  downloadDocumentExport,
} from "@/editor/panes/graph/document-export";
import { useWorkspaceStore } from "@/store/app";

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
    <Dialog
      backdrop="blur"
      description="Save the current material graph as a JSON document."
      label="Export Document"
      onOpenChange={(event) => onOpenChange(event.detail.value)}
      open={open}
    >
      <Field
        description="Keeps the title, node layout, editor view and UI settings, so the document reopens exactly as authored. Turn it off to export only the material graph."
        label="Include document metadata"
        orientation="horizontal"
      >
        <Checkbox
          checked={includeMetadata}
          onCheckedChange={(event) => setIncludeMetadata(event.detail.value)}
        />
      </Field>

      <Button slot="footer" variant="ghost" onClick={() => onOpenChange(false)}>
        Cancel
      </Button>
      <Button slot="footer" variant="outline" onClick={() => void handleCopy()}>
        {copied ? "Copied!" : "Copy to Clipboard"}
      </Button>
      <Button slot="footer" onClick={handleExport}>
        Export
      </Button>
    </Dialog>
  );
}
