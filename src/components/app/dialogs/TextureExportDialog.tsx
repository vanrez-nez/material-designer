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
import { useWorkspaceStore } from "@/store/app";
import { TEXTURE_CHANNELS, sortedTextureSockets } from "@/editor/panes/textures/channels";
import type { MaterialAppServices } from "@/components/app/services";
import type { PbrSocket } from "@/runtime";

type TextureExportDialogProps = {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  services: MaterialAppServices;
};

const EXPORT_SIZES = [
  { label: "512 px", value: 512 },
  { label: "1024 px", value: 1024 },
  { label: "2K", value: 2048 },
  { label: "4K", value: 4096 },
  { label: "8K", value: 8192 },
] as const;

const readAvailableChannels = (services: MaterialAppServices): PbrSocket[] => {
  try {
    return sortedTextureSockets(services.readConnectedTextureChannels());
  } catch (error) {
    console.warn("[texture-export] Could not read connected channels.", error);
    return [];
  }
};

export function TextureExportDialog({ onOpenChange, open, services }: TextureExportDialogProps) {
  const materialGraphEvent = useWorkspaceStore((state) => state.materialGraphEvent);
  const [availableChannels, setAvailableChannels] = useState<PbrSocket[]>([]);
  const [channels, setChannels] = useState<PbrSocket[]>([]);
  const [size, setSize] = useState(1024);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const nextAvailable = readAvailableChannels(services);
    setAvailableChannels(nextAvailable);
    setChannels(nextAvailable);
    setSize(1024);
    setIsExporting(false);
    setError("");
  }, [open, services]);

  useEffect(() => {
    if (!open || !materialGraphEvent || materialGraphEvent.change.kind === "layout") return;
    const nextAvailable = readAvailableChannels(services);
    const nextAvailableSet = new Set(nextAvailable);
    setAvailableChannels(nextAvailable);
    setChannels((current) =>
      sortedTextureSockets([...current, ...nextAvailable]).filter((channel) =>
        nextAvailableSet.has(channel),
      ),
    );
  }, [materialGraphEvent, open, services]);

  const selected = new Set(channels);
  const available = new Set(availableChannels);
  const exportDisabled = isExporting || channels.length === 0;

  function setChannel(channel: PbrSocket, checked: boolean): void {
    if (!available.has(channel)) return;
    setChannels((current) => {
      const next = new Set(current);
      if (checked) next.add(channel);
      else next.delete(channel);
      return sortedTextureSockets(next).filter((socket) => available.has(socket));
    });
  }

  async function handleExport(): Promise<void> {
    setIsExporting(true);
    setError("");
    try {
      await services.exportTextureZip({ channels, size });
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
              {TEXTURE_CHANNELS.map((channel) => {
                const id = `texture-export-${channel.id}`;
                const connected = available.has(channel.socket);

                return (
                  <label
                    key={channel.id}
                    className="flex cursor-pointer items-center justify-between gap-3 rounded-sm py-1 text-sm has-disabled:cursor-not-allowed has-disabled:text-muted-foreground"
                    htmlFor={id}
                  >
                    <span>{channel.label}</span>
                    <Checkbox
                      checked={selected.has(channel.socket)}
                      disabled={isExporting || !connected}
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
