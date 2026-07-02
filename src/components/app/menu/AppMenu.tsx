import { useRef } from "react";
import { Download, FileJson } from "lucide-react";
import type { MaterialGraphDocument } from "@/runtime";
import { dispatchMaterialDocumentLoad } from "@/app-events";
import { useMenuStore } from "@/store/menu";
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
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

export function AppMenu() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lastLoadedFile = useMenuStore((state) => state.lastLoadedFile);
  const loadError = useMenuStore((state) => state.loadError);
  const setLoadError = useMenuStore((state) => state.setLoadError);
  const setLoadedFile = useMenuStore((state) => state.setLoadedFile);

  async function loadFile(file: File): Promise<void> {
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      if (!isMaterialGraphDocument(parsed)) {
        throw new Error("JSON is not a MaterialGraphDocument.");
      }
      dispatchMaterialDocumentLoad(parsed, file.name);
      setLoadedFile(file.name);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[menu] Load failed:", message);
      setLoadError(message);
    }
  }

  return (
    <div className="app-menubar">
      <Menubar className="h-8 border-0 bg-transparent p-0 shadow-none">
        <MenubarMenu>
          <MenubarTrigger>File</MenubarTrigger>
          <MenubarContent align="start">
            <MenubarItem onSelect={() => inputRef.current?.click()}>
              <FileJson className="size-4" />
              Load
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem onSelect={() => undefined}>
              <Download className="size-4" />
              Export
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
