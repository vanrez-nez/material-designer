import { useSyncExternalStore } from "react";

// Below this width the workspace stacks its panes and drops controls that only make sense side by side.
const COMPACT_QUERY = "(max-width: 40rem)";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(COMPACT_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function useCompactLayout(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(COMPACT_QUERY).matches);
}
