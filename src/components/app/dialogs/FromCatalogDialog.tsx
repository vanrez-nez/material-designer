import { useEffect, useMemo, useState } from "react";
import { PackageOpen } from "lucide-react";
import {
  Button,
  DescriptionList,
  DescriptionListItem,
  Dialog,
  EmptyState,
  ScrollArea,
  Select,
  Spinner,
  Toggle,
  ToggleGroup,
} from "@tweakpad/ui/react";

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
    <Dialog
      className="catalog-dialog"
      description="Browse the material catalog by category."
      label="Open From Catalog"
      onOpenChange={(event) => onOpenChange(event.detail.value)}
      open={open}
    >
      <div className="catalog-browser">
        {compact ? (
          // A phone has no room for the category column: the categories become a picker above the grid.
          <Select
            className="catalog-browser__category-select"
            label="Category"
            value={categoryId}
            onValueChange={(event) => setCategoryId(String(event.detail.value))}
          >
            {(catalog?.categories ?? []).map((category) => (
              <option key={category.id} value={category.id}>
                {`${category.label} (${counts[category.id] ?? 0})`}
              </option>
            ))}
          </Select>
        ) : (
          <ScrollArea className="toggle-list" label="Categories">
            {/* One category is always chosen: re-pressing it proposes an empty selection, never accepted. */}
            <ToggleGroup
              label="Category"
              onValueChange={(event) => {
                const [next] = event.detail.value;
                if (next) setCategoryId(next);
              }}
              orientation="vertical"
              value={[categoryId]}
            >
              {(catalog?.categories ?? []).map((category) => (
                <Toggle key={category.id} value={category.id}>
                  <span className="toggle-list__name">{category.label}</span>
                  <span className="toggle-list__detail">{counts[category.id] ?? 0}</span>
                </Toggle>
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
              onValueChange={(event) => {
                const [next] = event.detail.value;
                if (next) setSelectedId(next);
              }}
              value={selectedId ? [selectedId] : []}
              variant="outline"
            >
              {materials.map((material) => (
                <Toggle
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
                </Toggle>
              ))}
            </ToggleGroup>
          </ScrollArea>
        )}
      </div>

      {selected ? (
        <DescriptionList className="catalog-dialog__details" orientation="horizontal" slot="footer">
          <DescriptionListItem label="Name">{selected.name}</DescriptionListItem>
          <DescriptionListItem label="Nodes">{selected.nodeCount}</DescriptionListItem>
          <DescriptionListItem label="Textures">{selected.textures.length}</DescriptionListItem>
        </DescriptionList>
      ) : null}
      <Button slot="footer" variant="ghost" onClick={() => onOpenChange(false)}>
        Cancel
      </Button>
      <Button slot="footer" disabled={!selected} onClick={handleOpen}>
        Open
      </Button>
    </Dialog>
  );
}
