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
    // Seed the current document as the first library entry on a fresh install — but NOT when the active
    // document is a transient catalog load (activeId null with a baseline set), which must stay unsaved
    // until edited.
    if (!library.activeId && library.transientBaseline === null) {
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
        const workspace = useWorkspaceStore.getState();
        useDocumentLibraryStore
          .getState()
          .autosaveActive(workspace.materialDocument, workspace.materialGraphRevision);
      }, AUTOSAVE_DEBOUNCE_MS);
    });

    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, []);
}
