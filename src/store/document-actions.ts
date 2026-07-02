import { dispatchMaterialDocumentLoad } from "@/app-events";
import type { MaterialGraphDocument } from "@/runtime";
import { useWorkspaceStore } from "@/store/app";
import { type DocumentEntry, useDocumentLibraryStore } from "@/store/document-library";

// Load a library entry into the live editor and clear the (global) undo stack so undo can't cross
// document boundaries. Goes through the existing MATERIAL_DOCUMENT_LOAD_EVENT path (boot.ts), which
// swaps the document, re-bakes the surface, and rebuilds the graph editor.
function activateEntry(entry: DocumentEntry): void {
  dispatchMaterialDocumentLoad(entry.document, entry.title);
  useWorkspaceStore.getState().clearHistory();
}

// Snapshot the current document into its library entry before switching away, so nothing is lost.
function saveCurrent(): void {
  useDocumentLibraryStore.getState().saveActive(useWorkspaceStore.getState().materialDocument);
}

export function newDocument(): void {
  saveCurrent();
  activateEntry(useDocumentLibraryStore.getState().createDocument());
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

const TITLE_MAX_LENGTH = 50;

// Rename the active document: clamps to 50 chars, ignores blank input (keeps the current title), and
// updates both the live document metadata and the library entry.
export function renameActiveDocument(rawTitle: string): void {
  const title = rawTitle.trim().slice(0, TITLE_MAX_LENGTH);
  if (!title) return;
  useWorkspaceStore.getState().setDocumentTitle(title);
  useDocumentLibraryStore.getState().renameActive(title);
}
