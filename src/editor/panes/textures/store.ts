import { create } from "zustand";

import type { PbrSocket } from "@/runtime";
import { TEXTURE_CHANNELS } from "@/editor/panes/textures/channels";

export type TexturePreviewImageState = {
  error: string | null;
  image: ImageData | null;
  loading: boolean;
  requestId: number;
};

export type TexturePreviewStore = {
  images: Record<PbrSocket, TexturePreviewImageState>;
  seams: boolean;
  tileSize: number;
  zoom: number;
  setImageError: (channel: PbrSocket, requestId: number, error: string) => void;
  setImageLoading: (channel: PbrSocket, requestId: number) => void;
  setImageReady: (
    channel: PbrSocket,
    requestId: number,
    image: ImageData | null,
  ) => void;
  setSeams: (seams: boolean) => void;
  setTileSize: (tileSize: number) => void;
  setZoom: (zoom: number) => void;
};

const emptyImageState = (): TexturePreviewImageState => ({
  error: null,
  image: null,
  loading: false,
  requestId: 0,
});

const createInitialImages = (): Record<PbrSocket, TexturePreviewImageState> =>
  Object.fromEntries(
    TEXTURE_CHANNELS.map((channel) => [channel.socket, emptyImageState()]),
  ) as Record<PbrSocket, TexturePreviewImageState>;

export const useTexturePreviewStore = create<TexturePreviewStore>()((set) => ({
  images: createInitialImages(),
  seams: false,
  tileSize: 160,
  zoom: 1,
  setImageError: (channel, requestId, error) =>
    set((state) => {
      if (state.images[channel].requestId !== requestId) return state;

      return {
        images: {
          ...state.images,
          [channel]: { ...state.images[channel], error, loading: false },
        },
      };
    }),
  setImageLoading: (channel, requestId) =>
    set((state) => ({
      images: {
        ...state.images,
        [channel]: {
          ...state.images[channel],
          error: null,
          loading: true,
          requestId,
        },
      },
    })),
  setImageReady: (channel, requestId, image) =>
    set((state) => {
      if (state.images[channel].requestId !== requestId) return state;

      return {
        images: {
          ...state.images,
          [channel]: { ...state.images[channel], error: null, image, loading: false },
        },
      };
    }),
  setSeams: (seams) => set({ seams }),
  setTileSize: (tileSize) => set({ tileSize }),
  setZoom: (zoom) => set({ zoom }),
}));
