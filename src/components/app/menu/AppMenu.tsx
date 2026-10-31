import { useEffect, useRef, useState } from "react";
import { Button, Kbd, KbdGroup, Menu, MenuItem, Menubar, Separator } from "@tweakpad/ui/react";
import type { MaterialGraphDocument } from "@/runtime";
import { MATERIAL_GRAPH_REBUILD_EVENT } from "@/app-events";
import { importDocumentFromFile } from "@/store/document-actions";
import { useWorkspaceStore } from "@/store/app";

function isMaterialGraphDocument(value: unknown): value is MaterialGraphDocument {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    Array.isArray((value as MaterialGraphDocument).nodes) &&
    Array.isArray((value as MaterialGraphDocument).edges)
  );
}

function isMacPlatform() {
  if (typeof navigator === "undefined") return false;

  return /Mac|iPhone|iPad/.test(navigator.platform);
}

function getModifierKeyLabel() {
  return isMacPlatform() ? "⌘" : "Ctrl";
}

// Marked as the menu item's shortcut, which the item lays out at its end.
function Shortcut({ keys }: { keys: string[] }) {
  return (
    <KbdGroup className="ml-auto pl-8" data-menu-shortcut="" separator="none">
      {keys.map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
    </KbdGroup>
  );
}

type AppMenuProps = {
  onExportDocument?: () => void;
  onExportTextures?: () => void;
  onNewDocument?: () => void;
  onMakeCopy?: () => void;
  onOpenDocument?: () => void;
  onOpenCatalog?: () => void;
  onClearSession?: () => void;
};

export function AppMenu({
  onExportDocument,
  onExportTextures,
  onNewDocument,
  onMakeCopy,
  onOpenDocument,
  onOpenCatalog,
  onClearSession,
}: AppMenuProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [lastLoadedFile, setLastLoadedFile] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const undoHistory = useWorkspaceStore((state) => state.undoHistory);
  const redoHistory = useWorkspaceStore((state) => state.redoHistory);
  const canUndo = useWorkspaceStore((state) => state.historyPast.length > 0);
  const canRedo = useWorkspaceStore((state) => state.historyFuture.length > 0);
  const modifierKeyLabel = getModifierKeyLabel();

  async function loadFile(file: File): Promise<void> {
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      if (!isMaterialGraphDocument(parsed)) {
        throw new Error("JSON is not a MaterialGraphDocument.");
      }
      importDocumentFromFile(parsed, file.name);
      setLastLoadedFile(file.name);
      setLoadError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[menu] Load failed:", message);
      setLoadError(message);
    }
  }

  function rebuildGraphEditor(): void {
    window.dispatchEvent(new CustomEvent(MATERIAL_GRAPH_REBUILD_EVENT));
  }

  function handleUndo(): void {
    undoHistory();
    rebuildGraphEditor();
  }

  function handleRedo(): void {
    redoHistory();
    rebuildGraphEditor();
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest("input, textarea, select") ||
        target?.isContentEditable
      ) {
        return;
      }
      const isMod = event.metaKey || event.ctrlKey;
      if (!isMod) return;
      const key = event.key.toLowerCase();

      // The menu's ⌘N / ⌘O hints: the shortcut hints only display them, so they are handled here.
      if ((key === "n" || key === "o") && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        if (key === "n") onNewDocument?.();
        else onOpenDocument?.();
        return;
      }

      if (key !== "z") return;

      event.preventDefault();
      event.stopPropagation();

      if (event.shiftKey) handleRedo();
      else handleUndo();
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [undoHistory, redoHistory, onNewDocument, onOpenDocument]);

  return (
    <div className="app-menubar">
      {/* Non-modal: an open menu leaves the rest of the page interactive. Activating an item closes it. */}
      <Menubar aria-label="Application menu" className="h-8 border-0 bg-transparent p-0 shadow-none" modal={false}>
        <Menu align="start" portal={false} value="file">
          <Button size="sm" slot="trigger" variant="ghost">
            File
          </Button>
          <MenuItem onClick={() => onNewDocument?.()}>
            <span>New</span>
            <Shortcut keys={[modifierKeyLabel, "N"]} />
          </MenuItem>
          <MenuItem onClick={() => onMakeCopy?.()}>
            <span>Make a Copy</span>
          </MenuItem>
          <Menu portal={false}>
            <Button slot="trigger" variant="ghost">
              Open
            </Button>
            <MenuItem onClick={() => onOpenDocument?.()}>
              <span>Document</span>
              <Shortcut keys={[modifierKeyLabel, "O"]} />
            </MenuItem>
            <MenuItem onClick={() => onOpenCatalog?.()}>
              <span>From Catalog</span>
            </MenuItem>
          </Menu>
          <Separator />
          <Menu portal={false}>
            <Button slot="trigger" variant="ghost">
              Export
            </Button>
            <MenuItem onClick={() => onExportDocument?.()}>
              <span>Document</span>
            </MenuItem>
            <MenuItem onClick={() => onExportTextures?.()}>
              <span>Textures</span>
            </MenuItem>
          </Menu>
          <Separator />
          <MenuItem onClick={() => inputRef.current?.click()}>
            <span>Load</span>
          </MenuItem>
        </Menu>
        <Menu align="start" portal={false} value="edit">
          <Button size="sm" slot="trigger" variant="ghost">
            Edit
          </Button>
          <MenuItem disabled={!canUndo} onClick={handleUndo}>
            <span>Undo</span>
            <Shortcut keys={[modifierKeyLabel, "Z"]} />
          </MenuItem>
          <MenuItem disabled={!canRedo} onClick={handleRedo}>
            <span>Redo</span>
            <Shortcut keys={[modifierKeyLabel, "⇧", "Z"]} />
          </MenuItem>
          <Separator />
          <MenuItem variant="destructive" onClick={() => onClearSession?.()}>
            <span>Clear Session</span>
          </MenuItem>
        </Menu>
      </Menubar>
      <input
        ref={inputRef}
        accept="application/json,.json"
        className="hidden"
        type="file"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void loadFile(file);
        }}
      />
      <div className="ml-auto truncate px-2 text-xs text-muted-foreground">
        {loadError ? `Load failed: ${loadError}` : lastLoadedFile ? `Loaded ${lastLoadedFile}` : null}
      </div>
    </div>
  );
}
