import { create } from "zustand";

type MenuLoadStatus = "idle" | "loaded" | "error";

interface MenuState {
  lastLoadedFile: string | null;
  loadError: string | null;
  loadStatus: MenuLoadStatus;
  setLoadError(error: string): void;
  setLoadedFile(filename: string): void;
}

export const useMenuStore = create<MenuState>((set) => ({
  lastLoadedFile: null,
  loadError: null,
  loadStatus: "idle",
  setLoadError: (error) => set({ loadError: error, loadStatus: "error" }),
  setLoadedFile: (filename) => set({ lastLoadedFile: filename, loadError: null, loadStatus: "loaded" }),
}));
