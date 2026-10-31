import { useEffect, useMemo, useState } from "react";
import { PackageOpen } from "lucide-react";

import { Button } from "@/components/ui/primitives/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
} from "@/components/ui/primitives/dialog";
import { DescriptionList, DescriptionListItem } from "@/components/ui/primitives/description-list";
import { EmptyState } from "@/components/ui/primitives/empty-state";
import { ScrollArea } from "@/components/ui/primitives/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/primitives/select";
import { Spinner } from "@/components/ui/primitives/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/primitives/toggle-group";
import {
  categoryCounts,
  loadCatalog,
  materialsInCategory,
  type Catalog,
  type CatalogMaterial,
} from "@/catalog/catalog";
import { useCompactLayout } from "@/lib/use-compact-layout";

type FromCatalogDialogProps = {
  onOpen: (material: CatalogMaterial) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

export function FromCatalogDialog({ onOpen, onOpenChange, open }: FromCatalogDialogProps) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [categoryId, setCategoryId] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const compact = useCompactLayout();

  const counts = useMemo(() => (catalog ? categoryCounts(catalog) : {}), [catalog]);
  const materials = useMemo(
    () => (catalog ? materialsInCategory(catalog, categoryId) : []),
    [catalog, categoryId],
  );
  const selected = selectedId ? catalog?.materials.find((m) => m.id === selectedId) ?? null : null;
  const activeCategory = catalog?.categories.find((entry) => entry.id === categoryId);

  // Load the catalog (public/catalog/catalog.json) the first time the dialog opens; the loader caches it.
  useEffect(() => {
    if (!open || catalog) return;
    let cancelled = false;
    void loadCatalog().then((loaded) => {
      if (!cancelled) setCatalog(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [open, catalog]);

  // Reset the selection (and default the category) whenever the dialog opens or the catalog arrives.
  // Categories are a fixed taxonomy, so some may hold no materials yet — open on the first populated
  // one so the grid isn't blank on arrival.
  useEffect(() => {
    if (!open) return;
    const categories = catalog?.categories ?? [];
    setCategoryId((categories.find((category) => (counts[category.id] ?? 0) > 0) ?? categories[0])?.id ?? "");
    setSelectedId(null);
  }, [open, catalog, counts]);

  function openMaterial(material: CatalogMaterial): void {
    onOpen(material);
    onOpenChange(false); // close the dialog on selection (Open button or double-click)
  }

  function handleOpen(): void {
    if (!selected) return;
    openMaterial(selected);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="catalog-dialog"
        description="Browse the material catalog by category."
        title="Open From Catalog"
      >

        <div className="catalog-browser">
          {compact ? (
            // A phone has no room for the category column: the categories become a picker above the grid.
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger aria-label="Category" className="catalog-browser__category-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(catalog?.categories ?? []).map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {`${category.label} (${counts[category.id] ?? 0})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <ScrollArea className="toggle-list" label="Categories">
              <ToggleGroup label="Category" onValueChange={setCategoryId} orientation="vertical" value={categoryId}>
                {(catalog?.categories ?? []).map((category) => (
                  <ToggleGroupItem key={category.id} value={category.id}>
                    <span className="toggle-list__name">{category.label}</span>
                    <span className="toggle-list__detail">{counts[category.id] ?? 0}</span>
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </ScrollArea>
          )}

          {!catalog ? (
            <EmptyState className="catalog-browser__materials catalog-browser__status" mediaTreatment="icon" title="Loading catalog…">
              <Spinner label="" slot="media" />
            </EmptyState>
          ) : materials.length === 0 ? (
            <EmptyState
              className="catalog-browser__materials catalog-browser__status"
              description="Materials added to this category will show up here."
              mediaTreatment="icon"
              title={`No ${activeCategory?.label.toLowerCase() ?? ""} materials yet`}
            >
              <PackageOpen aria-hidden slot="media" />
            </EmptyState>
          ) : (
            <ScrollArea className="catalog-browser__materials" label="Materials">
              <ToggleGroup
                className="catalog-grid"
                label="Material"
                onValueChange={setSelectedId}
                value={selectedId ?? ""}
                variant="outline"
              >
                {materials.map((material) => (
                  <ToggleGroupItem
                    key={material.id}
                    className="catalog-card"
                    value={material.id}
                    onDoubleClick={() => openMaterial(material)}
                  >
                    <img
                      src={`${import.meta.env.BASE_URL}${material.thumbnail}`}
                      alt=""
                      className="catalog-card__image"
                      draggable={false}
                    />
                    <span className="catalog-card__name">{material.name}</span>
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </ScrollArea>
          )}
        </div>

        <DialogFooter className="justify-between">
          {selected ? (
            <DescriptionList orientation="horizontal">
              <DescriptionListItem label="Name">{selected.name}</DescriptionListItem>
              <DescriptionListItem label="Nodes">{selected.nodeCount}</DescriptionListItem>
              <DescriptionListItem label="Textures">{selected.textures.length}</DescriptionListItem>
            </DescriptionList>
          ) : (
            <span />
          )}
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
