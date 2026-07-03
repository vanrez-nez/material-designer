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
import { cn } from "@/lib/utils";
import {
  catalog,
  categoryCounts,
  materialsInCategory,
  type CatalogMaterial,
} from "@/catalog/catalog";

type FromCatalogDialogProps = {
  onOpen: (material: CatalogMaterial) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

export function FromCatalogDialog({ onOpen, onOpenChange, open }: FromCatalogDialogProps) {
  const counts = useMemo(() => categoryCounts(), []);
  const [categoryId, setCategoryId] = useState(() => catalog.categories[0]?.id ?? "");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const materials = useMemo(() => materialsInCategory(categoryId), [categoryId]);
  const selected = selectedId ? catalog.materials.find((m) => m.id === selectedId) ?? null : null;

  useEffect(() => {
    if (!open) return;
    setCategoryId(catalog.categories[0]?.id ?? "");
    setSelectedId(null);
  }, [open]);

  function handleOpen(): void {
    if (!selected) return;
    onOpen(selected);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[860px]">
        <DialogHeader>
          <DialogTitle>Open From Catalog</DialogTitle>
          <DialogDescription>Browse the material catalog by category.</DialogDescription>
        </DialogHeader>

        <div className="flex h-[60vh] gap-4">
          {/* Left column: category sidebar. */}
          <div className="w-48 shrink-0 overflow-y-auto rounded-md border p-1">
            {catalog.categories.map((category) => (
              <button
                key={category.id}
                type="button"
                className={cn(
                  "flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent",
                  categoryId === category.id && "bg-accent font-medium",
                )}
                onClick={() => setCategoryId(category.id)}
              >
                <span className="truncate">{category.label}</span>
                <span className="text-xs text-muted-foreground">({counts[category.id] ?? 0})</span>
              </button>
            ))}
          </div>

          {/* Right column: thumbnail grid for the selected category. */}
          <div className="min-w-0 flex-1 overflow-y-auto rounded-md border p-3">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
              {materials.map((material) => (
                <button
                  key={material.id}
                  type="button"
                  className={cn(
                    "group flex flex-col overflow-hidden rounded-md border text-left transition-colors hover:border-ring",
                    selectedId === material.id && "border-primary ring-1 ring-primary",
                  )}
                  onClick={() => setSelectedId(material.id)}
                  onDoubleClick={() => onOpen(material)}
                >
                  <img
                    src={material.thumbnail}
                    alt={material.name}
                    className="aspect-square w-full object-cover"
                    draggable={false}
                  />
                  <span className="truncate px-2 py-1.5 text-xs">{material.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="sm:items-center sm:justify-between">
          <div className="min-w-0 truncate text-xs">
            {selected ? (
              <>
                <span className="text-foreground">Name:</span>{" "}
                <span className="text-muted-foreground/60">{selected.name}</span>
                <span className="ml-3 text-foreground">Nodes:</span>{" "}
                <span className="text-muted-foreground/60">{selected.nodeCount}</span>
                <span className="ml-3 text-foreground">Textures:</span>{" "}
                <span className="text-muted-foreground/60">{selected.textures.length}</span>
              </>
            ) : null}
          </div>
          <div className="flex gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="button" disabled={!selected} onClick={handleOpen}>
              Open
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
