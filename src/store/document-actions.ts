import { dispatchMaterialDocumentLoad } from "@/app-events";
import { cloneMaterialDocument, type MaterialGraphDocument } from "@/runtime";
import { useWorkspaceStore } from "@/store/app";
import { type DocumentEntry, useDocumentLibraryStore } from "@/store/document-library";

// Load a library entry into the live editor and clear the (global) undo stack so undo can't cross
// document boundaries. Goes through the existing MATERIAL_DOCUMENT_LOAD_EVENT path (boot.ts), which
// swaps the document, re-bakes the surface, and rebuilds the graph editor.
function activateEntry(entry: DocumentEntry): void {
  dispatchMaterialDocumentLoad(entry.document, entry.title);
  useWorkspaceStore.getState().clearHistory();
}

// Snapshot the current document into its library entry before switching away, so nothing is lost — but
// skip an unmodified transient (a catalog material that was only browsed), so it leaves no entry.
function saveCurrent(): void {
  const state = useWorkspaceStore.getState();
  useDocumentLibraryStore.getState().autosaveActive(state.materialDocument, state.materialGraphRevision);
}

export function newDocument(): void {
  saveCurrent();
  activateEntry(useDocumentLibraryStore.getState().createDocument());
}

// Fork the active document: snapshot the original into its own entry, then create a new library entry
// from a deep clone (so the copy shares no node/edge references) titled "Copy of <title>" and make it
// active — the editor switches to the copy while the original is preserved untouched.
export function duplicateActiveDocument(): void {
  saveCurrent();
  const { materialDocument } = useWorkspaceStore.getState();
  const currentTitle = materialDocument.metadata?.title?.trim() || "Untitled";
  const copyTitle = `Copy of ${currentTitle}`;
  activateEntry(
    useDocumentLibraryStore.getState().importDocument(cloneMaterialDocument(materialDocument), copyTitle),
  );
}

export function openDocument(id: string): void {
  saveCurrent();
  const entry = useDocumentLibraryStore.getState().setActive(id);
  if (entry) activateEntry(entry);
}

export function importDocumentFromFile(document: MaterialGraphDocument, title?: string): void {
  saveCurrent();
  activateEntry(useDocumentLibraryStore.getState().importDocument(document, title));
}

// Open a catalog material: load it into the editor as a TRANSIENT document — it isn't saved to the
// library (won't appear in Open > Document) until the user modifies it. The load bumps the graph
// revision to the transient baseline; the debounced autosave only creates an entry once a real edit
// advances the revision past that baseline.
export function openCatalogMaterial(document: MaterialGraphDocument, name: string): void {
  saveCurrent();
  dispatchMaterialDocumentLoad({ ...document, metadata: { ...document.metadata, title: name } }, name);
  useDocumentLibraryStore.getState().markTransient(useWorkspaceStore.getState().materialGraphRevision);
  useWorkspaceStore.getState().clearHistory();
}

const TITLE_MAX_LENGTH = 50;

// Rename the active document: clamps to 50 chars, ignores blank input (keeps the current title), and
// updates both the live document metadata and the library entry.
export function renameActiveDocument(rawTitle: string): void {
  const title = rawTitle.trim().slice(0, TITLE_MAX_LENGTH);
  if (!title) return;
  useWorkspaceStore.getState().setDocumentTitle(title);
  useDocumentLibraryStore.getState().renameActive(title);
}
