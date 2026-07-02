// Generic, reusable editor panel (Rete v2 + Lit). Decoupled from any domain: feed it an
// `EditorGraphConfig` (see types.ts) describing nodes, connections and per-node control mounts.
export { EditorPanel } from './editor-panel'
export type { EditorPanelOptions } from './editor-panel'
export type {
  DockMode,
  EditorGraphConfig,
  EditorNodeConfig,
  EditorConnectionConfig,
  EditorSocketConfig,
  EditorPaletteItem,
} from './types'
