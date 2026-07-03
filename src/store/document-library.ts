import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { MaterialGraphDocument } from "@/runtime";
import { createDefaultDocument } from "@/presets";

const DOCUMENT_LIBRARY_STORAGE_KEY = "material-designer-document-library";
const DEFAULT_TITLE = "Untitled";

export type DocumentEntry = {
  id: string;
  title: string;
  updatedAt: number;
  document: MaterialGraphDocument;
};

export type DocumentLibraryStore = {
  documents: Record<string, DocumentEntry>;
  activeId: string | null;
  // Set when the active document is a "transient" catalog material — loaded into the editor but not yet
  // saved as a library entry. Holds the workspace revision it was loaded at; it becomes a real entry only
  // once the graph revision advances past this (i.e. the user modified it). `null` = a normal document.
  transientBaseline: number | null;
  // Upsert the active document. Self-seeding: with no active entry it creates one and makes it active,
  // so the very first edit/session is captured without any explicit "new" step.
  saveActive: (document: MaterialGraphDocument) => DocumentEntry;
  // Autosave the active document, but skip an UNMODIFIED transient (catalog material browsed but not
  // edited): don't create an entry for it, so it never appears in Open > Document.
  autosaveActive: (document: MaterialGraphDocument, currentRevision: number) => void;
  // Mark the active document as a transient catalog load at the given workspace revision.
  markTransient: (baselineRevision: number) => void;
  // Create a fresh default document, make it active, and return its entry.
  createDocument: () => DocumentEntry;
  // Create an entry from a supplied document (e.g. a loaded file), make it active, and return it.
  importDocument: (document: MaterialGraphDocument, title?: string) => DocumentEntry;
  // Switch the active document; returns the entry (or null if the id is unknown).
  setActive: (id: string) => DocumentEntry | null;
  // Rename the active document (also stamps the title into its document metadata).
  renameActive: (title: string) => void;
};

function newId(): string {
  return crypto.randomUUID();
}

function documentTitle(document: MaterialGraphDocument): string | undefined {
  return document.metadata?.title?.trim() || undefined;
}

// Next "Untitled N" that doesn't collide with an existing entry title.
function nextUntitledTitle(documents: Record<string, DocumentEntry>): string {
  let max = 0;
  for (const entry of Object.values(documents)) {
    const match = /^Untitled(?:\s+(\d+))?$/.exec(entry.title.trim());
    if (match) max = Math.max(max, match[1] ? Number(match[1]) : 1);
  }
  return `${DEFAULT_TITLE} ${max + 1}`;
}

// Stamp a title into the document metadata so exports and the library agree.
function withTitle(document: MaterialGraphDocument, title: string): MaterialGraphDocument {
  return { ...document, metadata: { ...document.metadata, title } };
}

export const useDocumentLibraryStore = create<DocumentLibraryStore>()(
  persist(
    (set, get) => ({
      documents: {},
      activeId: null,
      transientBaseline: null,
      saveActive: (document) => {
        const state = get();
        const activeEntry = state.activeId ? state.documents[state.activeId] : undefined;

        if (!activeEntry) {
          const title = documentTitle(document) ?? nextUntitledTitle(state.documents);
          const entry: DocumentEntry = {
            id: newId(),
            title,
            updatedAt: Date.now(),
            document: withTitle(document, title),
          };
          set({
            documents: { ...state.documents, [entry.id]: entry },
            activeId: entry.id,
            transientBaseline: null,
          });
          return entry;
        }

        const entry: DocumentEntry = {
          ...activeEntry,
          title: documentTitle(document) ?? activeEntry.title,
          updatedAt: Date.now(),
          document,
        };
        set({ documents: { ...state.documents, [entry.id]: entry } });
        return entry;
      },
      autosaveActive: (document, currentRevision) => {
        const state = get();
        // Unmodified transient (catalog material browsed but not edited) → don't persist it.
        if (
          state.activeId === null &&
          state.transientBaseline !== null &&
          currentRevision <= state.transientBaseline
        ) {
          return;
        }
        get().saveActive(document);
      },
      markTransient: (baselineRevision) => set({ activeId: null, transientBaseline: baselineRevision }),
      createDocument: () => {
        const state = get();
        const title = nextUntitledTitle(state.documents);
        const entry: DocumentEntry = {
          id: newId(),
          title,
          updatedAt: Date.now(),
          document: withTitle(createDefaultDocument(), title),
        };
        set({
          documents: { ...state.documents, [entry.id]: entry },
          activeId: entry.id,
          transientBaseline: null,
        });
        return entry;
      },
      importDocument: (document, title) => {
        const state = get();
        const resolvedTitle = title?.trim() || documentTitle(document) || nextUntitledTitle(state.documents);
        const entry: DocumentEntry = {
          id: newId(),
          title: resolvedTitle,
          updatedAt: Date.now(),
          document: withTitle(document, resolvedTitle),
        };
        set({
          documents: { ...state.documents, [entry.id]: entry },
          activeId: entry.id,
          transientBaseline: null,
        });
        return entry;
      },
      setActive: (id) => {
        const entry = get().documents[id];
        if (!entry) return null;
        set({ activeId: id, transientBaseline: null });
        return entry;
      },
      renameActive: (title) => {
        const state = get();
        const activeEntry = state.activeId ? state.documents[state.activeId] : undefined;
        if (!activeEntry) return;
        const entry: DocumentEntry = {
          ...activeEntry,
          title,
          updatedAt: Date.now(),
          document: withTitle(activeEntry.document, title),
        };
        set({ documents: { ...state.documents, [entry.id]: entry } });
      },
    }),
    {
      name: DOCUMENT_LIBRARY_STORAGE_KEY,
      version: 1,
    },
  ),
);

// Entries newest-first, for the Open dialog table.
export function listDocuments(documents: Record<string, DocumentEntry>): DocumentEntry[] {
  return Object.values(documents).sort((a, b) => b.updatedAt - a.updatedAt);
}
