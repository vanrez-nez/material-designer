import "./styles.css";

import { preloadAssets } from "./lib/preload";

// Entry dispatcher. `/export-bake` boots an isolated headless bake (no preview scene, no Tweakpane);
// every other path boots the full app. Dynamic imports keep the two graphs apart — the export route never
// loads MainScene/tweakpane, and the normal route never loads the bake-setup module.
const path = new URL(location.href).pathname.replace(/\/+$/, "");
if (path === "/export-bake") {
  const { runExportBake } = await import("./debug/bake-setup");
  await runExportBake();
} else {
  // Warm the cache for the vendor chunks + eager assets with real 0–100% progress before the import chain
  // (which then runs from cache). Prod-only; dev keeps the indeterminate bar.
  if (import.meta.env.PROD) await preloadAssets();
  const { MaterialAppServices } = await import("./components/app/services");
  const services = new MaterialAppServices();
  const { mountApp } = await import("./components/app/mount");
  await mountApp(services);
  const { bootApp } = await import("./editor/panes/preview/boot");
  await bootApp(services);
}
