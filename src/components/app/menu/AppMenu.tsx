import { useEffect, useRef, useState } from "react";
import type { MaterialGraphDocument } from "@/runtime";
import { MATERIAL_GRAPH_REBUILD_EVENT } from "@/app-events";
import { importDocumentFromFile } from "@/store/document-actions";
import { useWorkspaceStore } from "@/store/app";
import { Kbd, KbdGroup } from "@/components/ui/primitives/kbd";
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from "@/components/ui/primitives/menubar";

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

function Shortcut({ keys }: { keys: string[] }) {
  return (
    <KbdGroup className="ml-auto pl-8">
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
  const [openMenu, setOpenMenu] = useState("");
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

  function closeMenu(): void {
    setOpenMenu("");
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
      if (!isMod || event.key.toLowerCase() !== "z") return;

      event.preventDefault();
      event.stopPropagation();

      if (event.shiftKey) handleRedo();
      else handleUndo();
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [undoHistory, redoHistory]);

  useEffect(() => {
    const isInsideMenu = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return false;

      return Boolean(
        target.closest("[data-app-menu-root]") || target.closest("[data-slot='menubar-content']"),
      );
    };

    const onOutsidePointer = (event: PointerEvent) => {
      if (!openMenu || isInsideMenu(event.target)) return;
      closeMenu();
    };

    const onOutsideFocus = (event: FocusEvent) => {
      if (!openMenu || isInsideMenu(event.target)) return;
      closeMenu();
    };

    window.addEventListener("pointerdown", onOutsidePointer, { capture: true });
    window.addEventListener("focusin", onOutsideFocus, { capture: true });

    return () => {
      window.removeEventListener("pointerdown", onOutsidePointer, { capture: true });
      window.removeEventListener("focusin", onOutsideFocus, { capture: true });
    };
  }, [openMenu]);

  return (
    <div className="app-menubar" data-app-menu-root>
      <Menubar
        aria-label="Application menu"
        className="h-8 border-0 bg-transparent p-0 shadow-none"
        value={openMenu}
        onValueChange={setOpenMenu}
      >
        <MenubarMenu value="file">
          <MenubarTrigger>File</MenubarTrigger>
          <MenubarContent align="start">
            <MenubarItem
              onSelect={() => {
                closeMenu();
                onNewDocument?.();
              }}
            >
              <span>New</span>
              <Shortcut keys={[modifierKeyLabel, "N"]} />
            </MenubarItem>
            <MenubarItem
              onSelect={() => {
                closeMenu();
                onMakeCopy?.();
              }}
            >
              <span>Make a Copy</span>
            </MenubarItem>
            <MenubarSub>
              <MenubarSubTrigger>Open</MenubarSubTrigger>
              <MenubarSubContent>
                <MenubarItem
                  onSelect={() => {
                    closeMenu();
                    onOpenDocument?.();
                  }}
                >
                  <span>Document</span>
                  <Shortcut keys={[modifierKeyLabel, "O"]} />
                </MenubarItem>
                <MenubarItem
                  onSelect={() => {
                    closeMenu();
                    onOpenCatalog?.();
                  }}
                >
                  <span>From Catalog</span>
                </MenubarItem>
              </MenubarSubContent>
            </MenubarSub>
            <MenubarSeparator />
            <MenubarSub>
              <MenubarSubTrigger>Export</MenubarSubTrigger>
              <MenubarSubContent>
                <MenubarItem
                  onSelect={() => {
                    closeMenu();
                    onExportDocument?.();
                  }}
                >
                  <span>Document</span>
                </MenubarItem>
                <MenubarItem
                  onSelect={() => {
                    closeMenu();
                    onExportTextures?.();
                  }}
                >
                  <span>Textures</span>
                </MenubarItem>
              </MenubarSubContent>
            </MenubarSub>
            <MenubarSeparator />
            <MenubarItem
              onSelect={() => {
                closeMenu();
                inputRef.current?.click();
              }}
            >
              <span>Load</span>
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>
        <MenubarMenu value="edit">
          <MenubarTrigger>Edit</MenubarTrigger>
          <MenubarContent align="start">
            <MenubarItem
              disabled={!canUndo}
              onSelect={() => {
                closeMenu();
                handleUndo();
              }}
            >
              <span>Undo</span>
              <Shortcut keys={[modifierKeyLabel, "Z"]} />
            </MenubarItem>
            <MenubarItem
              disabled={!canRedo}
              onSelect={() => {
                closeMenu();
                handleRedo();
              }}
            >
              <span>Redo</span>
              <Shortcut keys={[modifierKeyLabel, "⇧", "Z"]} />
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem
              variant="destructive"
              onSelect={() => {
                closeMenu();
                onClearSession?.();
              }}
            >
              <span>Clear Session</span>
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>
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
