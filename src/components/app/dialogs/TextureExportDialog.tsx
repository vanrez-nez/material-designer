import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/primitives/select";
import { TEXTURE_PREVIEW_CHANNELS } from "@/store/texture-preview";
import { getTextureExportHandler } from "@/texture-export/export-bridge";
import type { PbrSocket } from "@/runtime";

type TextureExportDialogProps = {
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

const EXPORT_SIZES = [
  { label: "512 px", value: 512 },
  { label: "1024 px", value: 1024 },
  { label: "2K", value: 2048 },
  { label: "4K", value: 4096 },
  { label: "8K", value: 8192 },
] as const;

const defaultChannels = (): PbrSocket[] =>
  TEXTURE_PREVIEW_CHANNELS.map((channel) => channel.socket);

export function TextureExportDialog({ onOpenChange, open }: TextureExportDialogProps) {
  const [channels, setChannels] = useState<PbrSocket[]>(defaultChannels);
  const [size, setSize] = useState(1024);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setChannels(defaultChannels());
    setSize(1024);
    setIsExporting(false);
    setError("");
  }, [open]);

  const selected = new Set(channels);
  const exportDisabled = isExporting || channels.length === 0;

  function setChannel(channel: PbrSocket, checked: boolean): void {
    setChannels((current) => {
      const next = new Set(current);
      if (checked) next.add(channel);
      else next.delete(channel);
      return defaultChannels().filter((socket) => next.has(socket));
    });
  }

  async function handleExport(): Promise<void> {
    const handler = getTextureExportHandler();
    if (!handler) {
      setError("Texture exporter is not ready yet.");
      return;
    }

    setIsExporting(true);
    setError("");
    try {
      await handler({ channels, size });
      onOpenChange(false);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Texture export failed.");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (isExporting ? undefined : onOpenChange(next))}>
      <DialogContent className="sm:max-w-md" showCloseButton={!isExporting}>
        <DialogHeader>
          <DialogTitle>Export Textures</DialogTitle>
          <DialogDescription>
            Bake selected material channels into a ZIP of PNG textures.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-sm">Texture size</span>
              <span className="text-xs text-muted-foreground">Resolution for every exported map.</span>
            </div>
            <Select
              disabled={isExporting}
              value={String(size)}
              onValueChange={(value) => setSize(Number(value))}
            >
              <SelectTrigger aria-label="Texture size" className="w-32 bg-background" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPORT_SIZES.map((option) => (
                  <SelectItem key={option.value} value={String(option.value)}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm">Channels</span>
            <div className="grid gap-2 rounded-md border bg-muted/20 p-3">
              {TEXTURE_PREVIEW_CHANNELS.map((channel) => {
                const id = `texture-export-${channel.id}`;

                return (
                  <label
                    key={channel.id}
                    className="flex cursor-pointer items-center justify-between gap-3 rounded-sm py-1 text-sm"
                    htmlFor={id}
                  >
                    <span>{channel.label}</span>
                    <Checkbox
                      checked={selected.has(channel.socket)}
                      disabled={isExporting}
                      id={id}
                      onCheckedChange={(checked) => setChannel(channel.socket, checked === true)}
                    />
                  </label>
                );
              })}
            </div>
          </div>

          {error ? (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button disabled={isExporting} type="button" variant="ghost">
              Cancel
            </Button>
          </DialogClose>
          <Button disabled={exportDisabled} type="button" onClick={() => void handleExport()}>
            {isExporting ? <Loader2 className="animate-spin" /> : null}
            Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
