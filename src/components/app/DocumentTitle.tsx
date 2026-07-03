import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Pencil } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/primitives/popover";
import { formatCompactRelativeTime } from "@/lib/datetime";
import { useWorkspaceStore } from "@/store/app";
import { openDocument, renameActiveDocument } from "@/store/document-actions";
import { listDocuments, useDocumentLibraryStore } from "@/store/document-library";

const TITLE_MAX_LENGTH = 50;
const TITLE_DISPLAY_LENGTH = 25;
const RECENT_COUNT = 5;

function truncateTitle(title: string): string {
  return title.length > TITLE_DISPLAY_LENGTH ? `${title.slice(0, TITLE_DISPLAY_LENGTH - 1)}…` : title;
}

export function DocumentTitle({ onShowAll }: { onShowAll: () => void }) {
  const documents = useDocumentLibraryStore((state) => state.documents);
  const activeId = useDocumentLibraryStore((state) => state.activeId);
  // A transient catalog material has no library entry yet — fall back to its document metadata title so
  // the header still shows the material name.
  const transientTitle = useWorkspaceStore((state) => state.materialDocument.metadata?.title);
  const activeTitle = (activeId && documents[activeId]?.title) || transientTitle || "Untitled";
  const recent = useMemo(() => listDocuments(documents).slice(0, RECENT_COUNT), [documents]);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Routes Enter/Escape through the single blur commit path (Enter/Escape blur the input); "cancel"
  // skips the commit so Esc doesn't save the edited draft.
  const exitRef = useRef<"commit" | "cancel">("commit");

  useEffect(() => {
    if (!editing) return;
    const input = inputRef.current;
    input?.focus();
    input?.select();
  }, [editing]);

  function startEdit(): void {
    setDraft(activeTitle);
    exitRef.current = "commit";
    setEditing(true);
  }

  function handleBlur(): void {
    if (exitRef.current === "commit") renameActiveDocument(draft);
    exitRef.current = "commit";
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="document-title__input"
        aria-label="Document title"
        maxLength={TITLE_MAX_LENGTH}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            exitRef.current = "commit";
            inputRef.current?.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            exitRef.current = "cancel";
            inputRef.current?.blur();
          }
        }}
        onBlur={handleBlur}
      />
    );
  }

  return (
    <div className="document-title">
      <button
        className="document-title__name"
        type="button"
        title={activeTitle}
        onClick={startEdit}
      >
        <Pencil className="document-title__pen size-3.5" aria-hidden />
        <span className="document-title__text">{truncateTitle(activeTitle)}</span>
      </button>
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild>
          <button
            className="document-title__chevron"
            type="button"
            aria-label="Recent documents"
          >
            <ChevronDown className="size-3.5" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent align="center" className="document-title__menu">
          {recent.map((entry) => (
            <button
              key={entry.id}
              className="document-title__recent"
              type="button"
              onClick={() => {
                if (entry.id !== activeId) openDocument(entry.id);
                setMenuOpen(false);
              }}
            >
              <span className="document-title__recent-name">{truncateTitle(entry.title)}</span>
              <span className="document-title__recent-time">
                {formatCompactRelativeTime(entry.updatedAt)}
              </span>
            </button>
          ))}
          <div className="document-title__sep" />
          <button
            className="document-title__show-all"
            type="button"
            onClick={() => {
              setMenuOpen(false);
              onShowAll();
            }}
          >
            Show All
          </button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
