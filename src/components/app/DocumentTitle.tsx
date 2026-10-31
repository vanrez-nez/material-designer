import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Pencil } from "lucide-react";
import type { TpInput } from "@tweakpad/ui";
import { Button, Input, Menu, MenuItem, Separator, Time } from "@tweakpad/ui/react";

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
  const inputRef = useRef<TpInput | null>(null);
  // Routes Enter/Escape through the single blur commit path (Enter/Escape blur the input); "cancel"
  // skips the commit so Esc doesn't save the edited draft.
  const exitRef = useRef<"commit" | "cancel">("commit");

  // The input renders its editor once it has updated; focus and select the draft then.
  useEffect(() => {
    if (!editing) return;
    const input = inputRef.current;
    void input?.updateComplete.then(() => {
      input.focus();
      input.select();
    });
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
      <Input
        ref={inputRef}
        className="document-title__input"
        label="Document title"
        maxLength={TITLE_MAX_LENGTH}
        value={draft}
        onValueChange={(event) => setDraft(String(event.detail.value ?? ""))}
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
      <Button className="document-title__name" size="sm" title={activeTitle} variant="ghost" onClick={startEdit}>
        <Pencil aria-hidden slot="icon-start" />
        {truncateTitle(activeTitle)}
      </Button>
      <Menu align="center" label="Recent documents" portal={false}>
        <Button aria-label="Recent documents" size="icon-xs" slot="trigger" variant="ghost">
          <ChevronDown aria-hidden slot="icon-start" />
        </Button>
        {recent.map((entry) => (
          <MenuItem key={entry.id} onClick={() => entry.id !== activeId && openDocument(entry.id)}>
            <span className="document-title__recent-name">{truncateTitle(entry.title)}</span>
            <Time
              className="document-title__recent-time"
              datetime={entry.updatedAt}
              mode="relative"
              numeric="always"
              relativeStyle="narrow"
              tooltip={false}
            />
          </MenuItem>
        ))}
        <Separator />
        <MenuItem onClick={onShowAll}>Show All</MenuItem>
      </Menu>
    </div>
  );
}
