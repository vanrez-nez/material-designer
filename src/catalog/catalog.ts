export type CatalogCategory = {
  id: string;
  label: string;
};

export type CatalogMaterial = {
  id: string;
  name: string;
  category: string;
  // Preset key resolved to a MaterialGraphDocument on open (fixture doc source; see src/presets).
  preset: string;
  thumbnail: string;
  nodeCount: number;
  textures: string[];
};

export type Catalog = {
  categories: CatalogCategory[];
  materials: CatalogMaterial[];
};

// The catalog is a regenerable data asset under public/ (see scripts/gen-catalog.mjs), fetched at
// runtime rather than bundled. Cached module-side so it's fetched at most once.
let cache: Promise<Catalog> | null = null;

export function loadCatalog(): Promise<Catalog> {
  if (!cache) {
    cache = fetch(`${import.meta.env.BASE_URL}catalog/catalog.json`).then((response) => {
      if (!response.ok) throw new Error(`Failed to load catalog: ${response.status}`);
      return response.json() as Promise<Catalog>;
    });
  }
  return cache;
}

// Materials in a category, in catalog order.
export function materialsInCategory(catalog: Catalog, categoryId: string): CatalogMaterial[] {
  return catalog.materials.filter((material) => material.category === categoryId);
}

// Number of materials per category id, for the sidebar counts ("Ground (14)").
export function categoryCounts(catalog: Catalog): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const material of catalog.materials) {
    counts[material.category] = (counts[material.category] ?? 0) + 1;
  }
  return counts;
}
