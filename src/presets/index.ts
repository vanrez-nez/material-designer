import { migrateMaterialDocument, type MaterialGraphDocument } from "@/runtime";
import defaultDoc from "./default.json";
import asphaltDoc from "./asphalt.json";
import barkDoc from "./bark.json";
import cobblestoneSettsDoc from "./cobblestone-setts.json";
import darkVolcanicStoneDoc from "./dark-volcanic-stone.json";
import ebonizedWoodDoc from "./ebonized-wood.json";
import woodDoc from "./wood.json";

// Material preset registry. Each preset is a plain JSON MaterialGraphDocument under presets/. Add a new
// `<name>.json` and one entry here to surface it in the Material panel's preset selector. `key` is the
// kebab-case filename stem and `label` matches the document's own metadata.title.
interface Preset {
  key: string;
  label: string;
  doc: MaterialGraphDocument;
}

export const MATERIAL_PRESETS: Preset[] = [
  { key: "empty", label: "Empty", doc: defaultDoc as MaterialGraphDocument },
  { key: "asphalt", label: "Asphalt", doc: asphaltDoc as MaterialGraphDocument },
  { key: "cobblestone-setts", label: "Cobblestone Setts", doc: cobblestoneSettsDoc as MaterialGraphDocument },
  { key: "dark-volcanic-stone", label: "Dark Volcanic Stone", doc: darkVolcanicStoneDoc as MaterialGraphDocument },
  { key: "bark", label: "Bark", doc: barkDoc as MaterialGraphDocument },
  { key: "ebonized-wood", label: "Ebonized Wood", doc: ebonizedWoodDoc as MaterialGraphDocument },
  { key: "wood", label: "Wood", doc: woodDoc as MaterialGraphDocument },
];
export const DEFAULT_PRESET = "empty"; // presets/default.json — the document loaded on a fresh session

// Clone + migrate the preset (the imported JSON is shared and may be an older schema version; migration
// clones, rewrites legacy Principled BSDF → shader-material, and stamps the current version).
export function makePreset(key: string): MaterialGraphDocument {
  const preset = MATERIAL_PRESETS.find((p) => p.key === key) ?? MATERIAL_PRESETS[0];
  return migrateMaterialDocument(preset.doc);
}

// The document loaded on a fresh session / reset (no persisted graph).
export function createDefaultDocument(): MaterialGraphDocument {
  return makePreset(DEFAULT_PRESET);
}
