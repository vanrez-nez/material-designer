import { create } from "zustand";

// Display state for the 2D texture preview. The images themselves are no longer stored here — the preview
// samples the surface's baked GPU textures directly (see TexturePreviewGpu); only the view controls live here.
export type TexturePreviewStore = {
  seams: boolean;
  tileSize: number;
  zoom: number;
  setSeams: (seams: boolean) => void;
  setTileSize: (tileSize: number) => void;
  setZoom: (zoom: number) => void;
};

export const useTexturePreviewStore = create<TexturePreviewStore>()((set) => ({
  seams: false,
  tileSize: 160,
  zoom: 1,
  setSeams: (seams) => set({ seams }),
  setTileSize: (tileSize) => set({ tileSize }),
  setZoom: (zoom) => set({ zoom }),
}));
