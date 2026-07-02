import { useEffect } from "react";

import { useWorkspaceStore } from "@/store/app";
import { useDocumentLibraryStore } from "@/store/document-library";

const AUTOSAVE_DEBOUNCE_MS = 800;

// Keeps the document library in sync with the live editing session:
// - seeds the current document as the first library entry on a fresh install, and
// - autosaves the active document (debounced) whenever the graph changes structurally/param-wise.
export function useDocumentLibrarySync(): void {
  useEffect(() => {
    const library = useDocumentLibraryStore.getState();
    if (!library.activeId) {
      library.saveActive(useWorkspaceStore.getState().materialDocument);
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = useWorkspaceStore.subscribe((state, previousState) => {
      if (state.materialGraphEvent === previousState.materialGraphEvent) return;
      const event = state.materialGraphEvent;
      // Layout-only edits (pan/zoom, node drag) aren't meaningful "modifications" — skip them so
      // last-modified stays honest.
      if (!event || event.change.kind === "layout") return;

      clearTimeout(timer);
      timer = setTimeout(() => {
        useDocumentLibraryStore.getState().saveActive(useWorkspaceStore.getState().materialDocument);
      }, AUTOSAVE_DEBOUNCE_MS);
    });

    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, []);
}
